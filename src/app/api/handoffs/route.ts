import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import { getConnector } from '@/lib/connectors/registry'
import { decrypt } from '@/lib/crypto/encryption'
import { maskPII } from '@/lib/governance/pii-masker'
import { logEvent } from '@/lib/governance/event-logger'
import { detectLoop } from '@/lib/governance/loop-detector'
import { checkAndDegrade } from '@/lib/governance/cost-controller'
import { checkProviderPolicy } from '@/lib/governance/provider-policy'
import { HANDOFF_TEMPLATES } from '@/lib/handoff/templates'
import type { Provider } from '@/lib/connectors/types'

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourceModelRunId, targetModel, templateId, userOverride, roomId } = await req.json()

  // ソース取得
  const sourceRun = await prisma.modelRun.findUnique({
    where: { id: sourceModelRunId },
    include: { assistantMessage: true },
  })
  if (!sourceRun?.assistantMessage) {
    return NextResponse.json({ error: 'Source run not found' }, { status: 404 })
  }

  // ループ検出（チェーン上限チェック + 内容重複チェック）
  const chainCount = await prisma.handoff.count({
    where: { sourceModelRunId, roomId },
  })
  if (chainCount >= 3) {
    return NextResponse.json({ error: 'Handoff chain limit reached (max 3)' }, { status: 400 })
  }

  // 過去のhandoffチェーンの内容でループ検出
  const existingHandoffs = await prisma.handoff.findMany({
    where: { roomId },
    include: { targetModelRun: { include: { assistantMessage: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const chainContents = existingHandoffs
    .map(h => h.targetModelRun?.assistantMessage?.content)
    .filter((c): c is string => !!c)
  chainContents.push(sourceRun.assistantMessage.content)
  if (detectLoop(chainContents)) {
    await logEvent(user.id, roomId, 'provider_block', { reason: 'loop_detected', sourceModelRunId })
    return NextResponse.json({ error: 'Loop detected: similar responses repeating' }, { status: 400 })
  }

  // プロバイダーポリシーチェック
  const policyCheck = checkProviderPolicy(sourceRun.assistantMessage.content)
  if (policyCheck.blocked) {
    await logEvent(user.id, roomId, 'provider_block', { reason: policyCheck.reason })
    return NextResponse.json({ error: policyCheck.reason }, { status: 400 })
  }

  // テンプレート展開
  const template = HANDOFF_TEMPLATES.VERIFY
  let prompt = template.buildPrompt(
    sourceRun.model,
    sourceRun.assistantMessage.content,
    userOverride
  )

  // PIIマスク
  const maskResult = maskPII(prompt)
  prompt = maskResult.masked

  // APIキー取得 & コスト制御
  const targetModelInfo = await getTargetModelInfo(targetModel)
  const apiKey = await getUserApiKey(user.id, targetModelInfo.provider)
  if (!apiKey) return NextResponse.json({ error: 'No API key for target provider' }, { status: 400 })

  // コスト上限チェック・劣化
  const { model: actualModel, degraded } = await checkAndDegrade(user.id, targetModel, targetModelInfo.provider)

  // 新規ModelRun
  const targetRun = await prisma.modelRun.create({
    data: {
      userMessageId: sourceRun.userMessageId,
      provider: targetModelInfo.provider,
      model: actualModel,
      status: 'RUNNING',
      piiMasked: maskResult.maskCount > 0,
    },
  })

  try {
    const connector = getConnector(targetModelInfo.provider)
    const result = await connector.send([{ role: 'user', content: prompt }], {
      provider: targetModelInfo.provider,
      model: actualModel,
      apiKey,
      maxTokens: 4096,
      temperature: 0.7,
      timeoutMs: 30000,
    })
    const cost = connector.estimateCost(result.inputTokens, result.outputTokens, actualModel)

    await prisma.modelRun.update({
      where: { id: targetRun.id },
      data: {
        status: 'COMPLETED',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: cost,
        latencyMs: result.latencyMs,
      },
    })

    await prisma.assistantMessage.create({
      data: { modelRunId: targetRun.id, content: result.content },
    })

    await prisma.usageLog.create({
      data: {
        userId: user.id,
        modelRunId: targetRun.id,
        provider: targetModelInfo.provider,
        model: actualModel,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: cost,
      },
    })

    const handoff = await prisma.handoff.create({
      data: {
        roomId,
        sourceModelRunId,
        targetModelRunId: targetRun.id,
        templateId: 'verify',
        templateType: 'VERIFY',
        composedPrompt: prompt,
        userOverride: userOverride ?? null,
      },
    })

    await logEvent(user.id, roomId, 'handoff', {
      handoffId: handoff.id,
      templateType: 'VERIFY',
      targetModel: actualModel,
      degraded,
      cost,
    })

    if (cost > 0) {
      await logEvent(user.id, roomId, 'cost', {
        modelRunId: targetRun.id,
        model: actualModel,
        cost,
      })
    }

    return NextResponse.json({ handoffId: handoff.id, targetRunId: targetRun.id })
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes('timeout')
    await prisma.modelRun.update({
      where: { id: targetRun.id },
      data: { status: isTimeout ? 'TIMEOUT' : 'FAILED' },
    })
    return NextResponse.json({ error: 'Handoff failed' }, { status: 500 })
  }
}

async function getTargetModelInfo(model: string): Promise<{ provider: Provider }> {
  const { SUPPORTED_MODELS } = await import('@/lib/connectors/types')
  const found = SUPPORTED_MODELS.find(m => m.model === model)
  return { provider: found?.provider ?? 'OPENAI' }
}

async function getUserApiKey(userId: string, provider: Provider): Promise<string | null> {
  const key = await prisma.userApiKey.findFirst({
    where: { userId, provider, isActive: true },
  })
  if (!key) return null
  return decrypt(key.encryptedKey)
}
