import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import { getConnector } from '@/lib/connectors/registry'
import { getUserApiKey } from '@/lib/db/api-keys'
import { maskPII } from '@/lib/governance/pii-masker'
import { SUPPORTED_MODELS, MODEL_PRICING } from '@/lib/connectors/types'
import type { ConnectorConfig, ConnectorMessage, Provider } from '@/lib/connectors/types'
import { judgeAllResponses } from '@/lib/eval/judge'
import { calculateObjectiveMetrics, normalizeScores } from '@/lib/eval/metrics-calculator'
import { getDefaultWeights, computeWeightedRanking, buildScoreMatrix } from '@/lib/eval/score-aggregator'
import { selectHighlights, buildCostProjection, generateRecommendation } from '@/lib/eval/report-generator'
import type { UseCaseProfile } from '@/lib/eval/types'
import { assertEvaluationScope, EvaluationScopeError, isEvaluationScopeError, promptWhere, responseWhere, runWhere, type BoundEvaluationScope } from '@/lib/eval/scope'

// Amplify Lambda has ~10s hard timeout — keep each request under 9s
const TIMEOUT_MS = 8000
const MAX_TOKENS = 1024

export async function POST(
  req: Request,
  { params }: { params: { id: string; runId: string } }
) {
  let authorizedScope: BoundEvaluationScope | null = null
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await prisma.evalProject.findFirst({
      where: { id: params.id, userId: user.id },
    })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Bind every step to the requested project and authenticated owner before
    // reading inputs, fetching provider keys, mutating status or calling AI.
    const requestedScope = { evalRunId: params.runId, projectId: params.id, userId: user.id }
    const authorizedRun = await prisma.evalRun.findFirst({
      where: runWhere(requestedScope),
      select: { id: true, promptSetId: true, targetModels: true },
    })
    if (!authorizedRun) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const scope: BoundEvaluationScope = { ...requestedScope, promptSetId: authorizedRun.promptSetId }
    authorizedScope = scope
    const runScope = runWhere(scope)

    const body = await req.json()
    const { step } = body
    console.log(`[eval-step] step=${step}, runId=${params.runId}`)

    // ============================================================
    // Step: init — Return prompt items and set status to RUNNING
    // ============================================================
    if (step === 'init') {
      const run = await prisma.evalRun.findUnique({
        where: runScope,
        include: {
          promptSet: { include: { promptItems: { orderBy: { orderIndex: 'asc' } } } },
        },
      })
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

      await prisma.evalRun.update({
        where: runScope,
        data: { status: 'RUNNING' },
      })
      await prisma.evalProject.update({
        where: { id: params.id, userId: user.id },
        data: { status: 'RUNNING' },
      })

      return NextResponse.json({
        promptItems: run.promptSet.promptItems.map(p => ({
          id: p.id,
          prompt: p.prompt,
        })),
        targetModels: run.targetModels,
        judgeModel: run.judgeModel,
      })
    }

    // ============================================================
    // Step: execute — Run prompts for ONE model (batch of up to 10)
    // ============================================================
    if (step === 'execute') {
      const { model, promptItemIds } = body as {
        model: string
        promptItemIds: string[]
      }

      if (!Array.isArray(promptItemIds) || promptItemIds.length < 1 || promptItemIds.length > 10 ||
          promptItemIds.some(id => typeof id !== 'string') || new Set(promptItemIds).size !== promptItemIds.length ||
          !authorizedRun.targetModels.includes(model)) {
        return NextResponse.json({ error: 'Invalid execution scope' }, { status: 400 })
      }
      const promptItems = await prisma.promptItem.findMany({
        where: { id: { in: promptItemIds }, promptSetId: authorizedRun.promptSetId,
          promptSet: { projectId: params.id, project: { userId: user.id } } },
      })
      if (promptItems.length !== promptItemIds.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      const modelInfo = SUPPORTED_MODELS.find(m => m.model === model)
      if (!modelInfo) return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 })

      const provider = modelInfo.provider as Provider
      await assertEvaluationScope(scope)
      const apiKey = await getUserApiKey(user.id, provider)
      if (!apiKey) return NextResponse.json({ error: `APIキーが見つかりません: ${provider}` }, { status: 400 })

      const connector = getConnector(provider)
      const config: ConnectorConfig = {
        provider,
        model,
        apiKey,
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
        timeoutMs: TIMEOUT_MS,
      }

      // Execute all prompts in this batch in parallel
      const results = await Promise.allSettled(
        promptItems.map(async (item) => {
          const { masked, maskCount } = maskPII(item.prompt)
          const messages: ConnectorMessage[] = [{ role: 'user', content: masked }]
          const start = Date.now()
          await assertEvaluationScope(scope)
          await prisma.promptItem.findUniqueOrThrow({
            where: { id: item.id, ...promptWhere(scope) }, select: { id: true },
          })

          try {
            const response = await connector.send(messages, config)
            const latencyMs = Date.now() - start
            const cost = connector.estimateCost(response.inputTokens, response.outputTokens, model)

            return await prisma.modelResponse.create({
              data: {
                evalRun: { connect: runScope },
                promptItem: { connect: { id: item.id, ...promptWhere(scope) } },
                provider,
                model,
                content: response.content,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                estimatedCostUsd: cost,
                latencyMs,
                status: 'COMPLETED',
                piiMasked: maskCount > 0,
              },
            })
          } catch (error) {
            if (isEvaluationScopeError(error)) throw error
            const latencyMs = Date.now() - start
            return await prisma.modelResponse.create({
              data: {
                evalRun: { connect: runScope },
                promptItem: { connect: { id: item.id, ...promptWhere(scope) } },
                provider,
                model,
                content: '',
                inputTokens: 0,
                outputTokens: 0,
                estimatedCostUsd: 0,
                latencyMs,
                status: latencyMs >= TIMEOUT_MS ? 'TIMEOUT' : 'FAILED',
                piiMasked: maskCount > 0,
              },
            })
          }
        })
      )
      if (results.some(result => result.status === 'rejected' && isEvaluationScopeError(result.reason))) {
        throw new EvaluationScopeError()
      }
      const rejected = results.find(result => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason

      const completed = results.filter(r => r.status === 'fulfilled').length
      return NextResponse.json({ completed, total: promptItems.length })
    }

    // ============================================================
    // Step: judge — Score a batch of responses (offset/limit)
    // ============================================================
    if (step === 'judge') {
      const { offset = 0, limit = 5 } = body as { offset?: number; limit?: number }

      await prisma.evalRun.update({
        where: runScope,
        data: { status: 'SCORING' },
      })

      const run = await prisma.evalRun.findUnique({
        where: runScope,
        include: { project: true },
      })
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

      const useCaseProfile = run.project.useCaseProfile as UseCaseProfile | null

      // Get unjudged completed responses (no JudgeScore yet)
      const unjudged = await prisma.modelResponse.findMany({
        where: {
          evalRunId: params.runId,
          evalRun: { projectId: params.id, project: { userId: user.id } },
          promptItem: { promptSetId: authorizedRun.promptSetId, promptSet: { projectId: params.id, project: { userId: user.id } } },
          status: 'COMPLETED',
          judgeScore: null,
        },
        include: { promptItem: true },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: limit,
      })

      if (unjudged.length === 0) {
        return NextResponse.json({ judged: 0, remaining: 0 })
      }

      // Judge this batch (in parallel for speed)
      const judgeInfo = SUPPORTED_MODELS.find(m => m.model === run.judgeModel)
      if (!judgeInfo) return NextResponse.json({ error: `Unknown judge model: ${run.judgeModel}` }, { status: 400 })

      await assertEvaluationScope(scope)
      const judgeApiKey = await getUserApiKey(user.id, judgeInfo.provider as Provider)
      if (!judgeApiKey) return NextResponse.json({ error: `ジャッジモデルのAPIキーが見つかりません: ${judgeInfo.provider}` }, { status: 400 })

      const judgeConnector = getConnector(judgeInfo.provider as Provider)
      const judgeConfig: ConnectorConfig = {
        provider: judgeInfo.provider as Provider,
        model: run.judgeModel,
        apiKey: judgeApiKey,
        maxTokens: 512,
        temperature: 0,
        timeoutMs: 8000,
      }

      const useCaseDesc = useCaseProfile
        ? `${useCaseProfile.domain} - ${useCaseProfile.audience}`
        : '一般的なAI利用'

      const judgeResults = await Promise.allSettled(
        unjudged.map(async (resp) => {
          const judgeMessages: ConnectorMessage[] = [{
            role: 'user',
            // The judge is another external AI call. Mask every interpolated
            // field after assembly, not only the earlier target-model prompt.
            content: maskPII(`あなたはAI回答の品質評価者です。以下のユーザー質問とAIの回答を評価してください。

## ユースケース
${useCaseDesc}

## 理想的な回答の方向性
${resp.promptItem.goldStandardHint || '特になし'}

## 質問
${resp.promptItem.prompt}

## AIの回答
${resp.content}

以下の5軸で1-5点で採点し、JSON形式のみで出力してください。
{"accuracy":{"score":1-5,"reason":"根拠"},"relevance":{"score":1-5,"reason":"..."},"conciseness":{"score":1-5,"reason":"..."},"tone":{"score":1-5,"reason":"..."},"instruction_following":{"score":1-5,"reason":"..."}}`).masked,
          }]
          await assertEvaluationScope(scope)
          await prisma.modelResponse.findUniqueOrThrow({
            where: { id: resp.id, ...responseWhere(scope) }, select: { id: true },
          })

          try {
            const judgeRes = await judgeConnector.send(judgeMessages, judgeConfig)
            const cleaned = judgeRes.content
              .replace(/^```(?:json)?\s*\n?/m, '')
              .replace(/\n?```\s*$/m, '')
              .trim()
            const parsed = JSON.parse(cleaned)
            const axes = ['accuracy', 'relevance', 'conciseness', 'tone', 'instruction_following']
            for (const axis of axes) {
              if (!parsed[axis]?.score) return
              parsed[axis].score = Math.max(1, Math.min(5, Math.round(parsed[axis].score)))
            }

            await prisma.judgeScore.create({
              data: {
                modelResponse: { connect: { id: resp.id, ...responseWhere(scope) } },
                judgeModel: run.judgeModel,
                accuracy: parsed.accuracy.score,
                relevance: parsed.relevance.score,
                conciseness: parsed.conciseness.score,
                tone: parsed.tone.score,
                instructionFollowing: parsed.instruction_following.score,
                reasons: {
                  accuracy: parsed.accuracy.reason || '',
                  relevance: parsed.relevance.reason || '',
                  conciseness: parsed.conciseness.reason || '',
                  tone: parsed.tone.reason || '',
                  instruction_following: parsed.instruction_following.reason || '',
                },
              },
            })
          } catch (error) {
            if (isEvaluationScopeError(error)) throw error
            // Skip failed judge calls
          }
        })
      )
      if (judgeResults.some(result => result.status === 'rejected' && isEvaluationScopeError(result.reason))) {
        throw new EvaluationScopeError()
      }
      const rejected = judgeResults.find(result => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason

      // Count remaining unjudged
      const remaining = await prisma.modelResponse.count({
        where: {
          evalRunId: params.runId,
          evalRun: { projectId: params.id, project: { userId: user.id } },
          promptItem: { promptSetId: authorizedRun.promptSetId, promptSet: { projectId: params.id, project: { userId: user.id } } },
          status: 'COMPLETED',
          judgeScore: null,
        },
      })

      return NextResponse.json({ judged: unjudged.length, remaining })
    }

    // ============================================================
    // Step: report — Generate final report
    // ============================================================
    if (step === 'report') {
      const run = await prisma.evalRun.findUnique({
        where: runScope,
        include: {
          project: true,
          promptSet: { include: { promptItems: true } },
        },
      })
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

      const useCaseProfile = run.project.useCaseProfile as UseCaseProfile | null

      const responsesWithScores = await prisma.modelResponse.findMany({
        where: { evalRunId: params.runId, evalRun: { projectId: params.id, project: { userId: user.id } },
          promptItem: { promptSetId: authorizedRun.promptSetId, promptSet: { projectId: params.id, project: { userId: user.id } } } },
        include: { judgeScore: true },
      })

      const metricsMap = calculateObjectiveMetrics(responsesWithScores, run.targetModels)
      const normalizedModelScores = normalizeScores(metricsMap)
      const priorities = useCaseProfile?.priority || []
      const weights = getDefaultWeights(priorities)
      const rankings = computeWeightedRanking(normalizedModelScores, weights)
      const scoreMatrix = buildScoreMatrix(normalizedModelScores)

      const highlights = selectHighlights(
        run.promptSet.promptItems.map(p => ({ id: p.id, prompt: p.prompt, category: p.category })),
        responsesWithScores.map(r => ({
          promptItemId: r.promptItemId,
          model: r.model,
          content: r.content,
          judgeScore: r.judgeScore,
        }))
      )

      const costProjection = buildCostProjection(
        responsesWithScores.map(r => ({
          model: r.model,
          provider: r.provider,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
        }))
      )

      let recommendation = ''
      try {
        recommendation = await generateRecommendation(rankings, scoreMatrix, useCaseProfile, scope)
      } catch (error) {
        if (isEvaluationScopeError(error)) throw error
        recommendation = '推奨アクションの生成に失敗しました。スコアテーブルを参考にモデルを選定してください。'
      }

      // Update actual cost
      const actualCost = responsesWithScores.reduce(
        (sum, r) => sum + (r.estimatedCostUsd ? Number(r.estimatedCostUsd) : 0), 0
      )

      await prisma.evalReport.create({
        data: {
          evalRun: { connect: runScope },
          rankings: rankings as any,
          scoreMatrix: scoreMatrix as any,
          highlights: highlights as any,
          costProjection: costProjection as any,
          recommendation,
        },
      })

      await prisma.evalRun.update({
        where: runScope,
        data: { status: 'COMPLETED', completedAt: new Date(), actualCostUsd: actualCost },
      })
      await prisma.evalProject.update({
        where: { id: params.id, userId: user.id },
        data: { status: 'COMPLETED' },
      })

      return NextResponse.json({ status: 'COMPLETED' })
    }

    return NextResponse.json({ error: '不正なstep' }, { status: 400 })
  } catch (error) {
    console.error('[eval-step] Evaluation failed', isEvaluationScopeError(error) ? 'scope unavailable' : 'request failed')

    // Do not mutate an untrusted run ID after an authentication/lookup error.
    if (authorizedScope) {
      await prisma.evalRun.update({
        where: runWhere(authorizedScope),
        data: { status: 'FAILED' },
      }).catch(() => {})
    }

    return NextResponse.json(
      { error: isEvaluationScopeError(error) ? 'Not found' : 'エラーが発生しました' },
      { status: isEvaluationScopeError(error) ? 404 : 500 }
    )
  }
}
