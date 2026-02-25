import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { decrypt } from '@/lib/crypto/encryption'
import { maskPII } from '@/lib/governance/pii-masker'
import { checkAndDegrade } from '@/lib/governance/cost-controller'
import { logEvent } from '@/lib/governance/event-logger'
import { checkProviderPolicy } from '@/lib/governance/provider-policy'
import { HANDOFF_TEMPLATES } from '@/lib/handoff/templates'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import type { Provider } from '@/lib/connectors/types'

const MODE_DEFAULTS = {
  verify: {
    primaryModel: { provider: 'OPENAI' as Provider, model: 'gpt-4o' },
    verifierModel: { provider: 'ANTHROPIC' as Provider, model: 'claude-sonnet-4-20250514' },
  },
  multi: {
    models: [
      { provider: 'OPENAI' as Provider, model: 'gpt-4o' },
      { provider: 'ANTHROPIC' as Provider, model: 'claude-sonnet-4-20250514' },
      { provider: 'GOOGLE' as Provider, model: 'gemini-2.5-flash' },
      { provider: 'XAI' as Provider, model: 'grok-3' },
    ],
  },
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { roomId, content, mode, targetModels, settings } = body

  // プロバイダーポリシーチェック
  const policyCheck = checkProviderPolicy(content)
  if (policyCheck.blocked) {
    await logEvent(user.id, roomId, 'provider_block', { reason: policyCheck.reason })
    return NextResponse.json({ error: policyCheck.reason }, { status: 400 })
  }

  // PIIマスキング
  const maskResult = maskPII(content)
  const maskedContent = maskResult.masked
  if (maskResult.maskCount > 0) {
    await logEvent(user.id, roomId, 'pii_mask', {
      maskCount: maskResult.maskCount,
      patterns: maskResult.patterns,
    })
  }

  // ルーム存在確認
  const room = await prisma.room.findFirst({ where: { id: roomId, userId: user.id } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // メッセージ数取得（orderIndex用）
  const msgCount = await prisma.userMessage.count({ where: { roomId } })

  // ルーム名自動生成（初回）
  if (msgCount === 0 && room.title === '新しい会話') {
    const autoTitle = content.slice(0, 40) + (content.length > 40 ? '...' : '')
    await prisma.room.update({ where: { id: roomId }, data: { title: autoTitle } })
  }

  // UserMessage作成
  const modelsToUse = targetModels ?? []
  const userMessage = await prisma.userMessage.create({
    data: {
      roomId,
      content: maskedContent,
      targetModels: modelsToUse,
      mode: mode ?? null,
      orderIndex: msgCount,
    },
  })

  await logEvent(user.id, roomId, 'user_message', {
    userMessageId: userMessage.id,
    mode,
    targetModels: modelsToUse,
  }, maskedContent)

  // APIキー取得
  const apiKeys = await prisma.userApiKey.findMany({
    where: { userId: user.id, isActive: true },
  })
  const keyMap: Record<string, string> = {}
  for (const k of apiKeys) {
    keyMap[k.provider] = decrypt(k.encryptedKey)
  }

  // モデル決定
  let models: { provider: Provider; model: string }[] = []
  if (modelsToUse.length > 0) {
    // 明示的にモデル指定がある場合
    for (const modelId of modelsToUse.slice(0, 3)) {
      const found = SUPPORTED_MODELS.find(m => m.model === modelId)
      if (found && keyMap[found.provider]) models.push({ provider: found.provider, model: found.model })
    }
  } else if (mode === 'multi') {
    // 多角的レビュー: デフォルト3モデル（APIキーがあるもの）
    for (const m of MODE_DEFAULTS.multi.models) {
      if (keyMap[m.provider]) models.push(m)
    }
  } else if (mode === 'verify') {
    // 厳密検証: 主AIモデル（検証は後でハンドオフ実行）
    const primary = MODE_DEFAULTS.verify.primaryModel
    if (keyMap[primary.provider]) models.push(primary)
  } else {
    // 通常: 利用可能なプロバイダーから1モデル
    for (const sm of SUPPORTED_MODELS) {
      if (keyMap[sm.provider] && models.length === 0) {
        models.push({ provider: sm.provider, model: sm.model })
      }
    }
  }

  if (models.length === 0) {
    return NextResponse.json(
      { error: '利用可能なAPIキーがありません。設定画面でAPIキーを登録してください。' },
      { status: 400 }
    )
  }

  // 並列実行
  const runPromises = models.map(async ({ provider, model }) => {
    if (!keyMap[provider]) return null

    const { model: actualModel, degraded } = await checkAndDegrade(user.id, model, provider)

    const modelRun = await prisma.modelRun.create({
      data: {
        userMessageId: userMessage.id,
        provider,
        model: actualModel,
        status: 'RUNNING',
        piiMasked: maskResult.maskCount > 0,
      },
    })

    try {
      const connector = getConnector(provider)
      const messages = [{ role: 'user' as const, content: maskedContent }]
      const cfg = {
        provider,
        model: actualModel,
        apiKey: keyMap[provider],
        maxTokens: settings?.maxTokens ?? 4096,
        temperature: settings?.temperature ?? 0.7,
        timeoutMs: 30000,
      }

      const result = await connector.send(messages, cfg)
      const cost = connector.estimateCost(result.inputTokens, result.outputTokens, actualModel)

      await prisma.modelRun.update({
        where: { id: modelRun.id },
        data: {
          status: 'COMPLETED',
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: cost,
          latencyMs: result.latencyMs,
        },
      })

      await prisma.assistantMessage.create({
        data: { modelRunId: modelRun.id, content: result.content },
      })

      await prisma.usageLog.create({
        data: {
          userId: user.id,
          modelRunId: modelRun.id,
          provider,
          model: actualModel,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: cost,
        },
      })

      await logEvent(user.id, roomId, 'model_run', {
        modelRunId: modelRun.id,
        model: actualModel,
        status: 'COMPLETED',
        cost,
        degraded,
      }, maskedContent)

      if (cost > 0) {
        await logEvent(user.id, roomId, 'cost', {
          modelRunId: modelRun.id,
          model: actualModel,
          cost,
        })
      }

      return modelRun.id
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timeout')
      console.error(`[ModelRun ${isTimeout ? 'TIMEOUT' : 'FAILED'}] provider=${provider} model=${actualModel}`, error)
      await prisma.modelRun.update({
        where: { id: modelRun.id },
        data: { status: isTimeout ? 'TIMEOUT' : 'FAILED' },
      })
      return null
    }
  })

  const results = await Promise.allSettled(runPromises)
  const completedRunIds = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => (r as PromiseFulfilledResult<string | null>).value)

  // Auto-VERIFY: verify mode で主モデル完了後、自動的に検証モデルを実行
  let verifyRunId: string | null = null
  if (mode === 'verify' && completedRunIds.length > 0) {
    const primaryRunId = completedRunIds[0]!
    const primaryRun = await prisma.modelRun.findUnique({
      where: { id: primaryRunId },
      include: { assistantMessage: true },
    })

    if (primaryRun?.assistantMessage) {
      const verifier = MODE_DEFAULTS.verify.verifierModel
      if (keyMap[verifier.provider]) {
        try {
          const { model: verifyModel, degraded: verifyDegraded } = await checkAndDegrade(user.id, verifier.model, verifier.provider)
          const template = HANDOFF_TEMPLATES.VERIFY
          const verifyPrompt = template.buildPrompt(primaryRun.model, primaryRun.assistantMessage.content)
          const { masked: maskedVerifyPrompt } = maskPII(verifyPrompt)

          const verifyModelRun = await prisma.modelRun.create({
            data: {
              userMessageId: userMessage.id,
              provider: verifier.provider,
              model: verifyModel,
              status: 'RUNNING',
              piiMasked: maskedVerifyPrompt !== verifyPrompt,
            },
          })

          const verifyConnector = getConnector(verifier.provider)
          const verifyResult = await verifyConnector.send(
            [{ role: 'user', content: maskedVerifyPrompt }],
            { provider: verifier.provider, model: verifyModel, apiKey: keyMap[verifier.provider], maxTokens: 4096, temperature: 0.7, timeoutMs: 30000 }
          )
          const verifyCost = verifyConnector.estimateCost(verifyResult.inputTokens, verifyResult.outputTokens, verifyModel)

          await prisma.modelRun.update({
            where: { id: verifyModelRun.id },
            data: { status: 'COMPLETED', inputTokens: verifyResult.inputTokens, outputTokens: verifyResult.outputTokens, estimatedCostUsd: verifyCost, latencyMs: verifyResult.latencyMs },
          })
          await prisma.assistantMessage.create({ data: { modelRunId: verifyModelRun.id, content: verifyResult.content } })
          await prisma.usageLog.create({
            data: { userId: user.id, modelRunId: verifyModelRun.id, provider: verifier.provider, model: verifyModel, inputTokens: verifyResult.inputTokens, outputTokens: verifyResult.outputTokens, estimatedCostUsd: verifyCost },
          })

          await prisma.handoff.create({
            data: { roomId, sourceModelRunId: primaryRunId, targetModelRunId: verifyModelRun.id, templateId: 'verify', templateType: 'VERIFY', composedPrompt: maskedVerifyPrompt },
          })

          await logEvent(user.id, roomId, 'handoff', { type: 'AUTO_VERIFY', primaryRunId, verifyRunId: verifyModelRun.id, verifyDegraded })

          verifyRunId = verifyModelRun.id
        } catch (err) {
          console.error('[Auto-VERIFY failed]', err)
        }
      }
    }
  }

  return NextResponse.json({
    userMessageId: userMessage.id,
    runIds: [...completedRunIds, ...(verifyRunId ? [verifyRunId] : [])],
  })
}
