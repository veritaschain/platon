import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { getUserApiKey } from '@/lib/db/api-keys'
import { SUPPORTED_MODELS, MODEL_PRICING } from '@/lib/connectors/types'
import type { ConnectorConfig, ConnectorMessage, Provider } from '@/lib/connectors/types'
import type {
  RankingEntry,
  ScoreMatrixEntry,
  HighlightEntry,
  CostProjectionEntry,
  UseCaseProfile,
  JudgeScoreResult,
} from './types'

// ============================================================
// Section 4: Highlight selection (score variance-based)
// ============================================================

export function selectHighlights(
  promptItems: { id: string; prompt: string; category: string }[],
  responses: {
    promptItemId: string
    model: string
    content: string
    judgeScore: {
      accuracy: number
      relevance: number
      conciseness: number
      tone: number
      instructionFollowing: number
      reasons: any
    } | null
  }[],
  maxCount = 3
): HighlightEntry[] {
  const promptScores = promptItems.map(item => {
    const itemResponses = responses.filter(r => r.promptItemId === item.id)

    // Calculate total score per response
    const scoredResponses = itemResponses.map(r => {
      const total = r.judgeScore
        ? (r.judgeScore.accuracy + r.judgeScore.relevance + r.judgeScore.conciseness +
           r.judgeScore.tone + r.judgeScore.instructionFollowing) / 5
        : 0

      return {
        model: r.model,
        content: r.content,
        scores: r.judgeScore ? {
          accuracy: { score: r.judgeScore.accuracy, reason: (r.judgeScore.reasons as any)?.accuracy || '' },
          relevance: { score: r.judgeScore.relevance, reason: (r.judgeScore.reasons as any)?.relevance || '' },
          conciseness: { score: r.judgeScore.conciseness, reason: (r.judgeScore.reasons as any)?.conciseness || '' },
          tone: { score: r.judgeScore.tone, reason: (r.judgeScore.reasons as any)?.tone || '' },
          instruction_following: { score: r.judgeScore.instructionFollowing, reason: (r.judgeScore.reasons as any)?.instruction_following || '' },
        } : null,
        totalScore: total,
      }
    })

    // Compute variance
    const totalScores = scoredResponses.map(r => r.totalScore).filter(s => s > 0)
    const mean = totalScores.length > 0 ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length : 0
    const variance = totalScores.length > 1
      ? totalScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / totalScores.length
      : 0

    return {
      promptItemId: item.id,
      prompt: item.prompt,
      category: item.category,
      responses: scoredResponses,
      varianceScore: variance,
    }
  })

  // Sort by variance descending and pick top N
  return promptScores
    .sort((a, b) => b.varianceScore - a.varianceScore)
    .slice(0, maxCount)
}

// ============================================================
// Section 5: Cost Projection
// ============================================================

export function buildCostProjection(
  responses: { model: string; provider: string; inputTokens: number | null; outputTokens: number | null }[]
): CostProjectionEntry[] {
  const modelGroups = new Map<string, { provider: string; inputTokens: number[]; outputTokens: number[] }>()

  for (const r of responses) {
    if (!modelGroups.has(r.model)) {
      modelGroups.set(r.model, { provider: r.provider, inputTokens: [], outputTokens: [] })
    }
    const group = modelGroups.get(r.model)!
    if (r.inputTokens !== null) group.inputTokens.push(r.inputTokens)
    if (r.outputTokens !== null) group.outputTokens.push(r.outputTokens)
  }

  return Array.from(modelGroups.entries()).map(([model, group]) => {
    const medianInput = median(group.inputTokens)
    const medianOutput = median(group.outputTokens)
    const pricing = MODEL_PRICING[model]
    const costPer1000 = pricing
      ? ((medianInput * pricing.input + medianOutput * pricing.output) / 1_000_000) * 1000
      : 0

    return {
      model,
      provider: group.provider as Provider,
      costPer1000: Math.round(costPer1000 * 1000) / 1000,
      medianInputTokens: medianInput,
      medianOutputTokens: medianOutput,
    }
  })
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ============================================================
// Section 6: Recommendation (LLM 1回)
// ============================================================

export async function generateRecommendation(
  rankings: RankingEntry[],
  scoreMatrix: ScoreMatrixEntry[],
  useCaseProfile: UseCaseProfile | null,
  userId: string
): Promise<string> {
  // Select cheap model
  const providers = [
    { provider: 'GOOGLE' as const, model: 'gemini-2.5-flash' },
    { provider: 'OPENAI' as const, model: 'gpt-4o-mini' },
    { provider: 'ANTHROPIC' as const, model: 'claude-haiku-4-5-20251001' },
  ]

  let selected: { provider: Provider; model: string; apiKey: string } | null = null
  for (const { provider, model } of providers) {
    const apiKey = await getUserApiKey(userId, provider)
    if (apiKey) {
      selected = { provider, model, apiKey }
      break
    }
  }

  if (!selected) return '推奨アクションの生成にはAPIキーが必要です。'

  const connector = getConnector(selected.provider)
  const config: ConnectorConfig = {
    provider: selected.provider,
    model: selected.model,
    apiKey: selected.apiKey,
    maxTokens: 1024,
    temperature: 0.3,
    timeoutMs: 30000,
  }

  const rankingText = rankings
    .map(r => `${r.rank}位: ${r.model} (スコア: ${r.totalScore}/10)`)
    .join('\n')

  const messages: ConnectorMessage[] = [
    {
      role: 'user',
      content: `あなたはAIモデル選定のコンサルタントです。
以下の評価結果に基づき、具体的な推奨アクションを1〜3個提示してください。

## ユースケース
${useCaseProfile ? JSON.stringify(useCaseProfile, null, 2) : '一般的なAI利用'}

## ランキング結果
${rankingText}

## スコア詳細
${JSON.stringify(scoreMatrix, null, 2)}

推奨アクションの例:
- 「Claude Sonnetをメインに採用し、シンプルな質問はGemini Flashにルーティングすることでコスト最適化を推奨」
- 具体的なモデル名と理由を含めてください
- Markdown形式で出力してください`,
    },
  ]

  try {
    const response = await connector.send(messages, config)
    return response.content
  } catch {
    return '推奨アクションの生成に失敗しました。スコアテーブルを参考にモデルを選定してください。'
  }
}
