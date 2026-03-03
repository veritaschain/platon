import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { getUserApiKey } from '@/lib/db/api-keys'
import { maskPII } from '@/lib/governance/pii-masker'
import { logEvent } from '@/lib/governance/event-logger'
import { SUPPORTED_MODELS, MODEL_PRICING } from '@/lib/connectors/types'
import type { ConnectorConfig, ConnectorMessage, Provider } from '@/lib/connectors/types'
import type { EvalProgressEvent, ExecutionResult } from './types'

const TIMEOUT_MS = 30000
const MAX_TOKENS = 4096
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1000

interface ExecutionParams {
  evalRunId: string
  userId: string
  promptItems: { id: string; prompt: string; goldStandardHint: string | null }[]
  targetModels: string[]
  onProgress?: (event: EvalProgressEvent) => void
}

export async function executeEvaluation(params: ExecutionParams): Promise<void> {
  const { evalRunId, userId, promptItems, targetModels, onProgress } = params

  // Resolve model → provider mapping
  const modelInfos = targetModels.map(model => {
    const info = SUPPORTED_MODELS.find(m => m.model === model)
    if (!info) throw new Error(`Unknown model: ${model}`)
    return info
  })

  // Pre-fetch API keys
  const apiKeyMap = new Map<Provider, string>()
  for (const info of modelInfos) {
    if (!apiKeyMap.has(info.provider as Provider)) {
      const key = await getUserApiKey(userId, info.provider as Provider)
      if (key) apiKeyMap.set(info.provider as Provider, key)
    }
  }

  const totalCount = promptItems.length * targetModels.length
  let completedCount = 0

  // Build all tasks: promptItem × model
  const tasks = promptItems.flatMap(item =>
    modelInfos.map(modelInfo => ({
      promptItem: item,
      modelInfo,
    }))
  )

  // Execute all with Promise.allSettled (reused from messages/send pattern)
  const results = await Promise.allSettled(
    tasks.map(async ({ promptItem, modelInfo }) => {
      const provider = modelInfo.provider as Provider
      const apiKey = apiKeyMap.get(provider)
      if (!apiKey) {
        throw new Error(`APIキーが見つかりません: ${provider}`)
      }

      const result = await executeWithRetry(
        userId,
        evalRunId,
        promptItem,
        provider,
        modelInfo.model,
        apiKey,
      )

      completedCount++
      onProgress?.({
        type: result.status === 'COMPLETED' ? 'response_complete' : 'response_error',
        model: modelInfo.model,
        completedCount,
        totalCount,
      })

      return result
    })
  )

  // Save all results to DB
  for (const result of results) {
    if (result.status === 'fulfilled') {
      await saveModelResponse(evalRunId, result.value)
    }
  }

  // Update actual cost
  const actualCost = results
    .filter((r): r is PromiseFulfilledResult<ExecutionResult> => r.status === 'fulfilled')
    .reduce((sum, r) => sum + r.value.estimatedCostUsd, 0)

  await prisma.evalRun.update({
    where: { id: evalRunId },
    data: { actualCostUsd: actualCost },
  })
}

async function executeWithRetry(
  userId: string,
  evalRunId: string,
  promptItem: { id: string; prompt: string },
  provider: Provider,
  model: string,
  apiKey: string,
  attempt = 0,
): Promise<ExecutionResult> {
  const connector = getConnector(provider)

  // PII masking
  const { masked, maskCount, patterns } = maskPII(promptItem.prompt)
  const piiMasked = maskCount > 0

  if (piiMasked) {
    logEvent(userId, evalRunId, 'pii_mask' as any, {
      promptItemId: promptItem.id,
      maskCount,
      patterns,
    })
  }

  const messages: ConnectorMessage[] = [
    { role: 'user', content: masked },
  ]

  const config: ConnectorConfig = {
    provider,
    model,
    apiKey,
    maxTokens: MAX_TOKENS,
    temperature: 0.3,
    timeoutMs: TIMEOUT_MS,
  }

  const startTime = Date.now()

  try {
    const response = await connector.send(messages, config)
    const latencyMs = Date.now() - startTime
    const cost = connector.estimateCost(response.inputTokens, response.outputTokens, model)

    // Log usage
    logEvent(userId, evalRunId, 'model_run' as any, {
      provider,
      model,
      status: 'COMPLETED',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cost,
      latencyMs,
    })

    return {
      modelResponseId: '',
      provider,
      model,
      promptItemId: promptItem.id,
      content: response.content,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      estimatedCostUsd: cost,
      latencyMs,
      status: 'COMPLETED',
      piiMasked,
    }
  } catch (error) {
    const latencyMs = Date.now() - startTime

    // Rate limit retry with exponential backoff
    if (attempt < MAX_RETRIES && isRateLimitError(error)) {
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt)
      await new Promise(resolve => setTimeout(resolve, backoff))
      return executeWithRetry(userId, evalRunId, promptItem, provider, model, apiKey, attempt + 1)
    }

    const status = latencyMs >= TIMEOUT_MS ? 'TIMEOUT' : 'FAILED'

    logEvent(userId, evalRunId, 'model_run' as any, {
      provider,
      model,
      status,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs,
    })

    return {
      modelResponseId: '',
      provider,
      model,
      promptItemId: promptItem.id,
      content: '',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs,
      status: status as 'FAILED' | 'TIMEOUT',
      piiMasked,
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')
  }
  return false
}

async function saveModelResponse(evalRunId: string, result: ExecutionResult): Promise<string> {
  const record = await prisma.modelResponse.create({
    data: {
      evalRunId,
      promptItemId: result.promptItemId,
      provider: result.provider,
      model: result.model,
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
      latencyMs: result.latencyMs,
      status: result.status,
      piiMasked: result.piiMasked,
    },
  })
  return record.id
}

export function estimateEvalCost(
  promptCount: number,
  targetModels: string[],
  judgeModel: string
): number {
  let totalCost = 0
  const avgInputTokens = 200
  const avgOutputTokens = 500

  // Phase 1: All prompts × all models
  for (const model of targetModels) {
    const pricing = MODEL_PRICING[model]
    if (!pricing) continue
    const perRequest = (avgInputTokens * pricing.input + avgOutputTokens * pricing.output) / 1_000_000
    totalCost += perRequest * promptCount
  }

  // Phase 3: Judge scoring (promptCount × modelCount judge calls)
  const judgePricing = MODEL_PRICING[judgeModel]
  if (judgePricing) {
    const judgeInputTokens = 800  // prompt + response + scoring template
    const judgeOutputTokens = 300
    const perJudge = (judgeInputTokens * judgePricing.input + judgeOutputTokens * judgePricing.output) / 1_000_000
    totalCost += perJudge * promptCount * targetModels.length
  }

  // Phase 4: Report recommendation (1 LLM call)
  if (judgePricing) {
    totalCost += (2000 * judgePricing.input + 500 * judgePricing.output) / 1_000_000
  }

  return totalCost
}
