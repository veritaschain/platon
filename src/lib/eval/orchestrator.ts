import { prisma } from '@/lib/db/client'
import { logEvent } from '@/lib/governance/event-logger'
import { executeEvaluation } from './execution-engine'
import { judgeAllResponses } from './judge'
import { calculateObjectiveMetrics, normalizeScores } from './metrics-calculator'
import { getDefaultWeights, computeWeightedRanking, buildScoreMatrix } from './score-aggregator'
import { selectHighlights, buildCostProjection, generateRecommendation } from './report-generator'
import type { EvalProgressEvent, UseCaseProfile } from './types'
import { assertEvaluationScope, isEvaluationScopeError, runWhere, responseWhere, type BoundEvaluationScope } from './scope'

export async function runFullEvaluation(
  evalRunId: string,
  userId: string,
  projectId: string,
  onProgress?: (event: EvalProgressEvent) => void
): Promise<void> {
  const requestedScope = { evalRunId, userId, projectId }
  let authorizedScope: BoundEvaluationScope | undefined
  try {
    // Load eval run with related data
    const evalRun = await prisma.evalRun.findUniqueOrThrow({
      where: runWhere(requestedScope),
      include: {
        promptSet: { include: { promptItems: { orderBy: { orderIndex: 'asc' } } } },
        project: true,
      },
    })
    authorizedScope = { ...requestedScope, promptSetId: evalRun.promptSetId }
    const scope = authorizedScope

    const useCaseProfile = evalRun.project.useCaseProfile as UseCaseProfile | null
    // Older execution paths could associate a foreign prompt with this run.
    // Keep those historical rows out of both judging and report aggregation.
    const responseScope = responseWhere(scope)

    // Update status to RUNNING
    await prisma.evalRun.update({
      where: runWhere(scope),
      data: { status: 'RUNNING' },
    })

    await prisma.evalProject.update({
      where: { id: projectId, userId },
      data: { status: 'RUNNING' },
    })

    logEvent(userId, evalRunId, 'model_run' as any, {
      type: 'eval_run_start',
      projectId: evalRun.projectId,
      targetModels: evalRun.targetModels,
      promptCount: evalRun.promptSet.promptItems.length,
    })

    // ============================================
    // Phase 1: Batch Execution
    // ============================================
    const promptItems = evalRun.promptSet.promptItems.map(item => ({
      id: item.id,
      prompt: item.prompt,
      goldStandardHint: item.goldStandardHint,
    }))

    await executeEvaluation({
      evalRunId,
      userId,
      projectId,
      promptSetId: evalRun.promptSetId,
      promptItems,
      targetModels: evalRun.targetModels,
      onProgress,
    })

    // ============================================
    // Phase 2: Objective Metrics (no LLM)
    // ============================================
    // (Metrics are calculated during report generation below)

    // ============================================
    // Phase 3: LLM-as-a-Judge Scoring
    // ============================================
    onProgress?.({ type: 'scoring_start', message: '品質採点を開始します...' })

    await prisma.evalRun.update({
      where: runWhere(scope),
      data: { status: 'SCORING' },
    })

    // Load all completed responses
    const allResponses = await prisma.modelResponse.findMany({
      where: { ...responseScope, status: 'COMPLETED' },
      include: { promptItem: true },
    })

    await judgeAllResponses({
      evalRunId,
      userId,
      projectId,
      promptSetId: evalRun.promptSetId,
      judgeModel: evalRun.judgeModel,
      useCaseProfile,
      responses: allResponses.map(r => ({
        modelResponseId: r.id,
        prompt: r.promptItem.prompt,
        goldStandardHint: r.promptItem.goldStandardHint,
        content: r.content,
      })),
    })

    onProgress?.({ type: 'scoring_complete', message: '品質採点が完了しました' })

    // ============================================
    // Phase 4: Score Aggregation + Report
    // ============================================
    onProgress?.({ type: 'report_generating', message: 'レポートを生成中...' })

    // Reload responses with judge scores
    const responsesWithScores = await prisma.modelResponse.findMany({
      where: responseScope,
      include: { judgeScore: true },
    })

    // Calculate metrics & normalize
    const metricsMap = calculateObjectiveMetrics(responsesWithScores, evalRun.targetModels)
    const normalizedModelScores = normalizeScores(metricsMap)

    // Get weights from priorities
    const priorities = useCaseProfile?.priority || []
    const weights = getDefaultWeights(priorities)

    // Compute ranking
    const rankings = computeWeightedRanking(normalizedModelScores, weights)

    // Build score matrix
    const scoreMatrix = buildScoreMatrix(normalizedModelScores)

    // Select highlights
    const highlights = selectHighlights(
      evalRun.promptSet.promptItems.map(p => ({
        id: p.id,
        prompt: p.prompt,
        category: p.category,
      })),
      responsesWithScores.map(r => ({
        promptItemId: r.promptItemId,
        model: r.model,
        content: r.content,
        judgeScore: r.judgeScore,
      }))
    )

    // Build cost projection
    const costProjection = buildCostProjection(
      responsesWithScores.map(r => ({
        model: r.model,
        provider: r.provider,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      }))
    )

    // Generate recommendation (LLM 1回)
    let recommendation = ''
    try {
      await assertEvaluationScope(scope)
      recommendation = await generateRecommendation(rankings, scoreMatrix, useCaseProfile, scope)
    } catch (error) {
      if (isEvaluationScopeError(error)) throw error
      recommendation = '推奨アクションの生成に失敗しました。スコアテーブルを参考にモデルを選定してください。'
    }

    // Save report
    await prisma.evalReport.create({
      data: {
        evalRun: { connect: runWhere(scope) },
        rankings: rankings as any,
        scoreMatrix: scoreMatrix as any,
        highlights: highlights as any,
        costProjection: costProjection as any,
        recommendation,
      },
    })

    // Mark as completed
    await prisma.evalRun.update({
      where: runWhere(scope),
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    await prisma.evalProject.update({
      where: { id: projectId, userId },
      data: { status: 'COMPLETED' },
    })

    logEvent(userId, evalRunId, 'model_run' as any, {
      type: 'eval_run_complete',
      projectId: evalRun.projectId,
    })

    onProgress?.({ type: 'complete', message: '評価が完了しました' })

  } catch (error) {
    // Authentication failure or ownership loss must not mutate a foreign run.
    if (authorizedScope) {
      await prisma.evalRun.update({
        where: runWhere(authorizedScope),
        data: { status: 'FAILED' },
      }).catch(() => {})
      await prisma.evalProject.update({
        where: { id: projectId, userId },
        data: { status: 'FAILED' },
      }).catch(() => {})
    }

    logEvent(userId, evalRunId, 'model_run' as any, {
      type: 'eval_run_error',
      error: 'Evaluation failed',
    })

    onProgress?.({
      type: 'error',
      message: '評価中にエラーが発生しました',
    })

    throw error
  }
}
