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

  // Provider policy check
  const policyCheck = checkProviderPolicy(content)
  if (policyCheck.blocked) {
    await logEvent(user.id, roomId, 'provider_block', { reason: policyCheck.reason })
    return NextResponse.json({ error: policyCheck.reason }, { status: 400 })
  }

  // PII masking
  const maskResult = maskPII(content)
  const maskedContent = maskResult.masked
  if (maskResult.maskCount > 0) {
    await logEvent(user.id, roomId, 'pii_mask', {
      maskCount: maskResult.maskCount,
      patterns: maskResult.patterns,
    })
  }

  // Room check
  const room = await prisma.room.findFirst({ where: { id: roomId, userId: user.id } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  // Message count for orderIndex
  const msgCount = await prisma.userMessage.count({ where: { roomId } })

  // Auto-generate room title on first message
  if (msgCount === 0 && room.title === '新しい会話') {
    const autoTitle = content.slice(0, 40) + (content.length > 40 ? '...' : '')
    await prisma.room.update({ where: { id: roomId }, data: { title: autoTitle } })
  }

  // Create UserMessage
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

  // Fetch API keys
  const apiKeys = await prisma.userApiKey.findMany({
    where: { userId: user.id, isActive: true },
  })
  const keyMap: Record<string, string> = {}
  for (const k of apiKeys) {
    keyMap[k.provider] = decrypt(k.encryptedKey)
  }

  // Determine models
  let models: { provider: Provider; model: string }[] = []
  if (modelsToUse.length > 0) {
    for (const modelId of modelsToUse.slice(0, 3)) {
      const found = SUPPORTED_MODELS.find(m => m.model === modelId)
      if (found && keyMap[found.provider]) models.push({ provider: found.provider, model: found.model })
    }
  } else if (mode === 'multi') {
    for (const m of MODE_DEFAULTS.multi.models) {
      if (keyMap[m.provider]) models.push(m)
    }
  } else if (mode === 'verify') {
    const primary = MODE_DEFAULTS.verify.primaryModel
    if (keyMap[primary.provider]) models.push(primary)
  } else {
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

  // --- SSE Streaming Response ---
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // init event: notify client of models to expect
        send({
          type: 'init',
          userMessageId: userMessage.id,
          models: models.map(m => ({ provider: m.provider, model: m.model })),
        })

        // Execute all models in parallel, emit run event as each completes
        const completedRunIds: string[] = []

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

            // Parallelize DB writes
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

            // Emit run event immediately
            send({
              type: 'run',
              run: {
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
              },
            })

            completedRunIds.push(modelRun.id)
            return modelRun.id
          } catch (error) {
            const isTimeout = error instanceof Error && error.message.includes('timeout')
            console.error(`[ModelRun ${isTimeout ? 'TIMEOUT' : 'FAILED'}] provider=${provider} model=${actualModel}`, error)
            await prisma.modelRun.update({
              where: { id: modelRun.id },
              data: { status: isTimeout ? 'TIMEOUT' : 'FAILED' },
            })

            // Emit failed run event
            send({
              type: 'run',
              run: {
                id: modelRun.id,
                model: actualModel,
                provider,
                status: isTimeout ? 'TIMEOUT' : 'FAILED',
                piiMasked: maskResult.maskCount > 0,
              },
            })

            return null
          }
        })

        await Promise.allSettled(runPromises)

        // Auto-VERIFY: verify mode - run verification model after primary completes
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
                    data: { roomId, sourceModelRunId: primaryRunId, targetModelRunId: verifyModelRun.id, templateId: 'verify', templateType: 'VERIFY', composedPrompt: maskedVerifyPrompt },
                  }),
                  logEvent(user.id, roomId, 'handoff', { type: 'AUTO_VERIFY', primaryRunId, verifyRunId: verifyModelRun.id, verifyDegraded }),
                ])

                // Emit verify run event
                send({
                  type: 'run',
                  run: {
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
                    handoffInfo: { sourceModelRunId: primaryRunId, templateType: 'VERIFY' },
                  },
                })
              } catch (err) {
                console.error('[Auto-VERIFY failed]', err)
              }
            }
          }
        }

        // Done event
        send({ type: 'done' })
      } catch (err) {
        console.error('[SSE stream error]', err)
        try {
          send({ type: 'error', error: 'ストリーム処理中にエラーが発生しました' })
        } catch {
          // controller may already be closed
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
