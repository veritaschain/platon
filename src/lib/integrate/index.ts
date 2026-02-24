import type { IntegrateInput, IntegrateOutput } from './types'
import { buildExtractionPrompt, parseExtraction } from './step1-extractor'
import { classifyStances } from './step15/stance-classifier'
import { extractConflicts } from './step15/conflict-extractor'
import { weightClaims } from './step15/claim-weigher'
import { classifyTrust } from './step15/trust-classifier'
import { buildSynthesisPrompt } from './step2-synthesizer'
import { buildFallbackPrompt } from './fallback'
import { getConnector } from '@/lib/connectors/registry'
import type { ConnectorConfig } from '@/lib/connectors/types'

export async function executeIntegrate(
  input: IntegrateInput,
  apiKeys: Record<string, string>
): Promise<IntegrateOutput> {
  // 安価なモデルを選択
  let extractProvider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' = 'OPENAI'
  if (apiKeys['OPENAI']) extractProvider = 'OPENAI'
  else if (apiKeys['GOOGLE']) extractProvider = 'GOOGLE'
  else if (apiKeys['ANTHROPIC']) extractProvider = 'ANTHROPIC'

  const extractModel = extractProvider === 'GOOGLE' ? 'gemini-2.5-flash'
    : extractProvider === 'ANTHROPIC' ? 'claude-haiku-4-5-20251001'
    : 'gpt-4o-mini'

  const step1Cfg: ConnectorConfig = {
    provider: extractProvider,
    model: extractModel,
    apiKey: apiKeys[extractProvider] ?? '',
    maxTokens: 1024,
    temperature: 0.1,
    timeoutMs: 30000,
  }

  const extractions = []
  let fallbackUsed = false
  let failedCount = 0

  // Step 1: 構造抽出（1回リトライ付き）
  for (const response of input.responses) {
    let success = false
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const connector = getConnector(step1Cfg.provider)
        const result = await connector.send(buildExtractionPrompt(response.content), step1Cfg)
        const extraction = parseExtraction(result.content, response.modelName)
        if (extraction) {
          extractions.push(extraction)
          success = true
          break
        }
      } catch (err) {
        console.error(`[Step1] Extraction attempt ${attempt + 1} failed for ${response.modelName}`, err)
      }
    }
    if (!success) {
      failedCount++
    }
  }

  // 半数以上失敗したらフォールバック
  if (failedCount > input.responses.length / 2 || extractions.length === 0) {
    fallbackUsed = true
  }

  if (fallbackUsed) {
    const synthProvider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' =
      apiKeys['OPENAI'] ? 'OPENAI' : apiKeys['ANTHROPIC'] ? 'ANTHROPIC' : 'GOOGLE'
    const synthModel = synthProvider === 'GOOGLE' ? 'gemini-2.5-flash'
      : synthProvider === 'ANTHROPIC' ? 'claude-haiku-4-5-20251001'
      : 'gpt-4o-mini'
    const synthCfg: ConnectorConfig = {
      provider: synthProvider,
      model: synthModel,
      apiKey: apiKeys[synthProvider] ?? '',
      maxTokens: 2048,
      temperature: 0.7,
      timeoutMs: 30000,
    }
    const connector = getConnector(synthCfg.provider)
    const fallbackResult = await connector.send(buildFallbackPrompt(input.responses), synthCfg)
    const emptyTrust = { highTrust: [], conditional: [], uncertain: [] }
    return {
      step1Extractions: [],
      step15TrustStructure: emptyTrust,
      step15Conflicts: [],
      step2Prompt: 'fallback',
      step2Output: fallbackResult.content,
      fallbackUsed: true,
    }
  }

  // Step 1.5: ルールベース前処理
  let stanceInfo, conflicts, weightedClaims, trustStructure
  try {
    stanceInfo = classifyStances(extractions)
    conflicts = extractConflicts(extractions)
    weightedClaims = weightClaims(extractions, input.debateResults)
    trustStructure = classifyTrust(weightedClaims, conflicts, input.responses.length)
  } catch (err) {
    console.error('[Step1.5] Processing error, using fallback', err)
    // Step 1.5 エラー時: 抽出結果はあるのでフォールバック合成
    const synthProvider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' =
      apiKeys['OPENAI'] ? 'OPENAI' : apiKeys['ANTHROPIC'] ? 'ANTHROPIC' : 'GOOGLE'
    const synthModel = synthProvider === 'GOOGLE' ? 'gemini-2.5-flash'
      : synthProvider === 'ANTHROPIC' ? 'claude-haiku-4-5-20251001'
      : 'gpt-4o-mini'
    const synthCfg: ConnectorConfig = {
      provider: synthProvider,
      model: synthModel,
      apiKey: apiKeys[synthProvider] ?? '',
      maxTokens: 2048,
      temperature: 0.7,
      timeoutMs: 30000,
    }
    const connector = getConnector(synthCfg.provider)
    const fallbackResult = await connector.send(buildFallbackPrompt(input.responses), synthCfg)
    return {
      step1Extractions: extractions,
      step15TrustStructure: { highTrust: [], conditional: [], uncertain: [] },
      step15Conflicts: [],
      step2Prompt: 'fallback',
      step2Output: fallbackResult.content,
      fallbackUsed: true,
    }
  }

  const stanceDist = Object.entries(stanceInfo.distribution)
    .filter(([, models]) => models.length > 0)
    .map(([stance, models]) => `${stance}: ${models.join(', ')}`)
    .join(' | ')

  // Step 2: 統合結論生成
  const { prompt, messages } = buildSynthesisPrompt(trustStructure, conflicts, stanceDist)

  const synthProvider: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' =
    apiKeys['OPENAI'] ? 'OPENAI' : apiKeys['ANTHROPIC'] ? 'ANTHROPIC' : 'GOOGLE'
  const synthModel = synthProvider === 'GOOGLE' ? 'gemini-2.5-pro'
    : synthProvider === 'ANTHROPIC' ? 'claude-sonnet-4-20250514'
    : 'gpt-4o'
  const synthCfg: ConnectorConfig = {
    provider: synthProvider,
    model: synthModel,
    apiKey: apiKeys[synthProvider] ?? '',
    maxTokens: 2048,
    temperature: 0.7,
    timeoutMs: 30000,
  }

  const synthConnector = getConnector(synthCfg.provider)
  const synthResult = await synthConnector.send(messages, synthCfg)

  // Step 2 出力バリデーション
  if (!synthResult.content || synthResult.content.trim().length < 10) {
    console.error('[Step2] Output too short, falling back')
    const fallbackConnector = getConnector(synthCfg.provider)
    const fallbackResult = await fallbackConnector.send(buildFallbackPrompt(input.responses), synthCfg)
    return {
      step1Extractions: extractions,
      step15TrustStructure: trustStructure,
      step15Conflicts: conflicts,
      step2Prompt: prompt,
      step2Output: fallbackResult.content,
      fallbackUsed: true,
    }
  }

  return {
    step1Extractions: extractions,
    step15TrustStructure: trustStructure,
    step15Conflicts: conflicts,
    step2Prompt: prompt,
    step2Output: synthResult.content,
    fallbackUsed: false,
  }
}
