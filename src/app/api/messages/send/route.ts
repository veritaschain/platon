import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import { getConnector } from '@/lib/connectors/registry'
import { decrypt } from '@/lib/crypto/encryption'
import { maskPII } from '@/lib/governance/pii-masker'
import { checkAndDegrade } from '@/lib/governance/cost-controller'
import { logEvent } from '@/lib/governance/event-logger'
import { checkProviderPolicy } from '@/lib/governance/provider-policy'
import { HANDOFF_TEMPLATES } from '@/lib/handoff/templates'
import { SUPPORTED_MODELS, IMAGE_CONSTRAINTS } from '@/lib/connectors/types'
import type { Provider, ImageAttachment } from '@/lib/connectors/types'

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
      { provider: 'XAI' as Provider, model: 'grok-4-fast-non-reasoning' },
    ],
  },
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { roomId, content, mode, targetModels, settings, images: rawImages } = body

  // 画像バリデーション
  let validatedImages: ImageAttachment[] | undefined
  if (rawImages && Array.isArray(rawImages) && rawImages.length > 0) {
    if (rawImages.length > IMAGE_CONSTRAINTS.maxCount) {
      return NextResponse.json(
        { error: `画像は${IMAGE_CONSTRAINTS.maxCount}枚まで添付できます` },
        { status: 400 }
      )
    }

    for (const img of rawImages) {
      if (!img.base64 || !img.mimeType) {
        return NextResponse.json({ error: '不正な画像データです' }, { status: 400 })
      }

      if (!(IMAGE_CONSTRAINTS.allowedMimeTypes as readonly string[]).includes(img.mimeType)) {
        return NextResponse.json(
          { error: `サポートされていない画像形式です: ${img.mimeType}。JPEG, PNG, GIF, WebPのみ対応しています` },
          { status: 400 }
        )
      }

      const sizeBytes = Math.ceil(img.base64.length * 3 / 4)
      if (sizeBytes > IMAGE_CONSTRAINTS.maxSizeBytes) {
        const maxMB = IMAGE_CONSTRAINTS.maxSizeBytes / (1024 * 1024)
        return NextResponse.json(
          { error: `画像サイズが${maxMB}MBを超えています` },
          { status: 400 }
        )
      }
    }

    validatedImages = rawImages as ImageAttachment[]
    await logEvent(user.id, roomId, 'image_attachment', {
      count: validatedImages.length,
      mimeTypes: validatedImages.map(i => i.mimeType),
    })
  }

  // テキストも画像もない場合はエラー
  const textContent = content ?? ''
  if (!textContent.trim() && !validatedImages) {
    return NextResponse.json({ error: 'メッセージまたは画像を入力してください' }, { status: 400 })
  }

  // プロバイダーポリシーチェック（テキストのみ対象）
  const policyCheck = checkProviderPolicy(textContent)
  if (policyCheck.blocked) {
    await logEvent(user.id, roomId, 'provider_block', { reason: policyCheck.reason })
    return NextResponse.json({ error: policyCheck.reason }, { status: 400 })
  }

  // PIIマスキング（テキストのみ対象、画像はバイパス）
  const maskResult = maskPII(textContent)
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
  interface RunResult {
    id: string
    model: string
    provider: string
    status: 'COMPLETED' | 'FAILED' | 'TIMEOUT'
    inputTokens?: number
    outputTokens?: number
    estimatedCostUsd?: number
    latencyMs?: number
    piiMasked: boolean
    assistantMessage?: { id: string; content: string }
    handoffInfo?: { sourceModelRunId: string; templateType: string }
  }

  const runs: RunResult[] = []

  const runPromises = models.map(async ({ provider, model }) => {
    if (!keyMap[provider]) return

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
      const messages = [{ role: 'user' as const, content: maskedContent, ...(validatedImages ? { images: validatedImages } : {}) }]
      const cfg = {
        provider,
        model: actualModel,
        apiKey: keyMap[provider],
        maxTokens: settings?.maxTokens ?? 4096,
        temperature: settings?.temperature ?? 0.7,
        timeoutMs: 8000,
      }

      const result = await connector.send(messages, cfg)
      const cost = connector.estimateCost(result.inputTokens, result.outputTokens, actualModel)

      // DB書き込みを並列化
      const [, assistantMsg] = await Promise.all([
        prisma.modelRun.update({
          where: { id: modelRun.id },
          data: {
            status: 'COMPLETED',
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            estimatedCostUsd: cost,
            latencyMs: result.latencyMs,
          },
        }),
        prisma.assistantMessage.create({
          data: { modelRunId: modelRun.id, content: result.content },
        }),
        prisma.usageLog.create({
          data: {
            userId: user.id,
            modelRunId: modelRun.id,
            provider,
            model: actualModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            estimatedCostUsd: cost,
          },
        }),
        logEvent(user.id, roomId, 'model_run', {
          modelRunId: modelRun.id,
          model: actualModel,
          status: 'COMPLETED',
          cost,
          degraded,
        }, maskedContent),
        cost > 0
          ? logEvent(user.id, roomId, 'cost', {
              modelRunId: modelRun.id,
              model: actualModel,
              cost,
            })
          : Promise.resolve(),
      ])

      runs.push({
        id: modelRun.id,
        model: actualModel,
        provider,
        status: 'COMPLETED',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: cost,
        latencyMs: result.latencyMs,
        piiMasked: maskResult.maskCount > 0,
        assistantMessage: { id: assistantMsg.id, content: result.content },
      })
    } catch (error: any) {
      const isTimeout = error instanceof Error && error.message.includes('timeout')
      const errorMsg = error?.message ?? error?.error?.message ?? String(error)
      console.error(`[ModelRun ${isTimeout ? 'TIMEOUT' : 'FAILED'}] provider=${provider} model=${actualModel}`, errorMsg)
      await prisma.modelRun.update({
        where: { id: modelRun.id },
        data: { status: isTimeout ? 'TIMEOUT' : 'FAILED' },
      })

      runs.push({
        id: modelRun.id,
        model: actualModel,
        provider,
        status: isTimeout ? 'TIMEOUT' : 'FAILED',
        piiMasked: maskResult.maskCount > 0,
        assistantMessage: { id: '', content: errorMsg },
      })
    }
  })

  await Promise.allSettled(runPromises)

  // Auto-VERIFY: verify mode で主モデル完了後、自動的に検証モデルを実行
  const completedRuns = runs.filter(r => r.status === 'COMPLETED')
  if (mode === 'verify' && completedRuns.length > 0) {
    const primaryRun = completedRuns[0]

    if (primaryRun.assistantMessage) {
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

          const [, verifyAssistantMsg] = await Promise.all([
            prisma.modelRun.update({
              where: { id: verifyModelRun.id },
              data: { status: 'COMPLETED', inputTokens: verifyResult.inputTokens, outputTokens: verifyResult.outputTokens, estimatedCostUsd: verifyCost, latencyMs: verifyResult.latencyMs },
            }),
            prisma.assistantMessage.create({ data: { modelRunId: verifyModelRun.id, content: verifyResult.content } }),
            prisma.usageLog.create({
              data: { userId: user.id, modelRunId: verifyModelRun.id, provider: verifier.provider, model: verifyModel, inputTokens: verifyResult.inputTokens, outputTokens: verifyResult.outputTokens, estimatedCostUsd: verifyCost },
            }),
            prisma.handoff.create({
              data: { roomId, sourceModelRunId: primaryRun.id, targetModelRunId: verifyModelRun.id, templateId: 'verify', templateType: 'VERIFY', composedPrompt: maskedVerifyPrompt },
            }),
            logEvent(user.id, roomId, 'handoff', { type: 'AUTO_VERIFY', primaryRunId: primaryRun.id, verifyRunId: verifyModelRun.id, verifyDegraded }),
          ])

          runs.push({
            id: verifyModelRun.id,
            model: verifyModel,
            provider: verifier.provider,
            status: 'COMPLETED',
            inputTokens: verifyResult.inputTokens,
            outputTokens: verifyResult.outputTokens,
            estimatedCostUsd: verifyCost,
            latencyMs: verifyResult.latencyMs,
            piiMasked: maskedVerifyPrompt !== verifyPrompt,
            assistantMessage: { id: verifyAssistantMsg.id, content: verifyResult.content },
            handoffInfo: { sourceModelRunId: primaryRun.id, templateType: 'VERIFY' },
          })
        } catch (err) {
          console.error('[Auto-VERIFY failed]', err)
        }
      }
    }
  }

  return NextResponse.json({
    userMessageId: userMessage.id,
    runs,
  })
}
