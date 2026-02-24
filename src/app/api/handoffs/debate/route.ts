import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { decrypt } from '@/lib/crypto/encryption'
import { maskPII } from '@/lib/governance/pii-masker'
import { logEvent } from '@/lib/governance/event-logger'
import { detectLoop } from '@/lib/governance/loop-detector'
import { checkAndDegrade } from '@/lib/governance/cost-controller'
import { checkProviderPolicy } from '@/lib/governance/provider-policy'
import { HANDOFF_TEMPLATES } from '@/lib/handoff/templates'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import type { Provider } from '@/lib/connectors/types'

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourceModelRunId, opponentModel, roomId } = await req.json()

  const sourceRun = await prisma.modelRun.findUnique({
    where: { id: sourceModelRunId },
    include: { assistantMessage: true },
  })
  if (!sourceRun?.assistantMessage) {
    return NextResponse.json({ error: 'Source run not found' }, { status: 404 })
  }

  // プロバイダーポリシーチェック
  const policyCheck = checkProviderPolicy(sourceRun.assistantMessage.content)
  if (policyCheck.blocked) {
    await logEvent(user.id, roomId, 'provider_block', { reason: policyCheck.reason })
    return NextResponse.json({ error: policyCheck.reason }, { status: 400 })
  }

  const opponentInfo = SUPPORTED_MODELS.find(m => m.model === opponentModel)
  if (!opponentInfo) return NextResponse.json({ error: 'Invalid model' }, { status: 400 })

  const opponentKeyRecord = await prisma.userApiKey.findFirst({
    where: { userId: user.id, provider: opponentInfo.provider, isActive: true },
  })
  if (!opponentKeyRecord) return NextResponse.json({ error: 'No API key for opponent' }, { status: 400 })
  const opponentKey = decrypt(opponentKeyRecord.encryptedKey)

  const sourceKeyRecord = await prisma.userApiKey.findFirst({
    where: { userId: user.id, provider: sourceRun.provider, isActive: true },
  })
  if (!sourceKeyRecord) return NextResponse.json({ error: 'No API key for source' }, { status: 400 })
  const sourceKey = decrypt(sourceKeyRecord.encryptedKey)

  const template = HANDOFF_TEMPLATES.DEBATE

  // コスト劣化チェック
  const { model: actualOpponentModel, degraded: opponentDegraded } = await checkAndDegrade(user.id, opponentModel, opponentInfo.provider)
  const { model: actualSourceModel, degraded: sourceDegraded } = await checkAndDegrade(user.id, sourceRun.model, sourceRun.provider)

  // Step 1: 反論
  const counterPrompt = template.buildCounterPrompt(sourceRun.model, sourceRun.assistantMessage.content)
  const { masked: maskedCounter } = maskPII(counterPrompt)

  const counterRun = await prisma.modelRun.create({
    data: {
      userMessageId: sourceRun.userMessageId,
      provider: opponentInfo.provider,
      model: actualOpponentModel,
      status: 'RUNNING',
      piiMasked: maskedCounter !== counterPrompt,
    },
  })

  try {
    const opponentConnector = getConnector(opponentInfo.provider)
    const counterResult = await opponentConnector.send(
      [{ role: 'user', content: maskedCounter }],
      { provider: opponentInfo.provider, model: actualOpponentModel, apiKey: opponentKey, maxTokens: 2048, temperature: 0.7, timeoutMs: 30000 }
    )
    const counterCost = opponentConnector.estimateCost(counterResult.inputTokens, counterResult.outputTokens, actualOpponentModel)

    await prisma.modelRun.update({
      where: { id: counterRun.id },
      data: { status: 'COMPLETED', inputTokens: counterResult.inputTokens, outputTokens: counterResult.outputTokens, latencyMs: counterResult.latencyMs, estimatedCostUsd: counterCost },
    })
    await prisma.assistantMessage.create({ data: { modelRunId: counterRun.id, content: counterResult.content } })
    await prisma.usageLog.create({
      data: { userId: user.id, modelRunId: counterRun.id, provider: opponentInfo.provider, model: actualOpponentModel, inputTokens: counterResult.inputTokens, outputTokens: counterResult.outputTokens, estimatedCostUsd: counterCost },
    })

    // ループ検出
    if (detectLoop([sourceRun.assistantMessage.content, counterResult.content])) {
      await logEvent(user.id, roomId, 'provider_block', { reason: 'loop_in_debate' })
      return NextResponse.json({ counterRunId: counterRun.id, stopped: true, reason: 'loop_detected' })
    }

    await prisma.handoff.create({
      data: {
        roomId,
        sourceModelRunId,
        targetModelRunId: counterRun.id,
        templateId: 'debate_counter',
        templateType: 'DEBATE',
        composedPrompt: maskedCounter,
      },
    })

    // Step 2: 再反論
    const rebuttalPrompt = template.buildRebuttalPrompt(
      sourceRun.model,
      sourceRun.assistantMessage.content,
      counterResult.content
    )
    const { masked: maskedRebuttal } = maskPII(rebuttalPrompt)

    const rebuttalRun = await prisma.modelRun.create({
      data: {
        userMessageId: sourceRun.userMessageId,
        provider: sourceRun.provider,
        model: actualSourceModel,
        status: 'RUNNING',
        piiMasked: maskedRebuttal !== rebuttalPrompt,
      },
    })

    const sourceConnector = getConnector(sourceRun.provider)
    const rebuttalResult = await sourceConnector.send(
      [{ role: 'user', content: maskedRebuttal }],
      { provider: sourceRun.provider, model: actualSourceModel, apiKey: sourceKey, maxTokens: 2048, temperature: 0.7, timeoutMs: 30000 }
    )
    const rebuttalCost = sourceConnector.estimateCost(rebuttalResult.inputTokens, rebuttalResult.outputTokens, actualSourceModel)

    await prisma.modelRun.update({
      where: { id: rebuttalRun.id },
      data: { status: 'COMPLETED', inputTokens: rebuttalResult.inputTokens, outputTokens: rebuttalResult.outputTokens, latencyMs: rebuttalResult.latencyMs, estimatedCostUsd: rebuttalCost },
    })
    await prisma.assistantMessage.create({ data: { modelRunId: rebuttalRun.id, content: rebuttalResult.content } })
    await prisma.usageLog.create({
      data: { userId: user.id, modelRunId: rebuttalRun.id, provider: sourceRun.provider, model: actualSourceModel, inputTokens: rebuttalResult.inputTokens, outputTokens: rebuttalResult.outputTokens, estimatedCostUsd: rebuttalCost },
    })

    await prisma.handoff.create({
      data: {
        roomId,
        sourceModelRunId: counterRun.id,
        targetModelRunId: rebuttalRun.id,
        templateId: 'debate_rebuttal',
        templateType: 'DEBATE',
        composedPrompt: maskedRebuttal,
      },
    })

    await logEvent(user.id, roomId, 'handoff', {
      type: 'DEBATE',
      counterRunId: counterRun.id,
      rebuttalRunId: rebuttalRun.id,
      opponentDegraded,
      sourceDegraded,
    })

    await logEvent(user.id, roomId, 'cost', {
      counterCost,
      rebuttalCost,
      totalCost: counterCost + rebuttalCost,
    })

    return NextResponse.json({
      counterRunId: counterRun.id,
      rebuttalRunId: rebuttalRun.id,
      stopped: true,
    })
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes('timeout')
    console.error(`[Debate ${isTimeout ? 'TIMEOUT' : 'FAILED'}]`, error)
    await prisma.modelRun.update({
      where: { id: counterRun.id },
      data: { status: isTimeout ? 'TIMEOUT' : 'FAILED' },
    }).catch(() => {})
    return NextResponse.json({ error: 'Debate failed' }, { status: 500 })
  }
}
