import { PromptCategory } from '@prisma/client'
import { getConnector } from '@/lib/connectors/registry'
import { getUserApiKey } from '@/lib/db/api-keys'
import type { ConnectorConfig, ConnectorMessage } from '@/lib/connectors/types'
import type {
  HearingAnswers,
  UseCaseProfile,
  CategoryDistribution,
  GeneratedPrompt,
} from './types'
import { getSeedPrompts } from './seed-prompts'

// ============================================================
// Cheap model selection (reused from integrate/index.ts pattern)
// ============================================================

async function selectCheapModel(
  userId: string
): Promise<{ provider: 'OPENAI' | 'GOOGLE' | 'ANTHROPIC'; model: string; apiKey: string } | null> {
  const providers = [
    { provider: 'GOOGLE' as const, model: 'gemini-2.5-flash' },
    { provider: 'OPENAI' as const, model: 'gpt-4o-mini' },
    { provider: 'ANTHROPIC' as const, model: 'claude-haiku-4-5-20251001' },
  ]

  for (const { provider, model } of providers) {
    const apiKey = await getUserApiKey(userId, provider)
    if (apiKey) return { provider, model, apiKey }
  }
  return null
}

// ============================================================
// Stage 1: Hearing → UseCaseProfile (LLM 1回)
// ============================================================

export async function generateUseCaseProfile(
  answers: HearingAnswers,
  userId: string
): Promise<UseCaseProfile> {
  const selected = await selectCheapModel(userId)
  if (!selected) throw new Error('利用可能なAPIキーがありません')

  const connector = getConnector(selected.provider)
  const config: ConnectorConfig = {
    provider: selected.provider,
    model: selected.model,
    apiKey: selected.apiKey,
    maxTokens: 1024,
    temperature: 0.1,
    timeoutMs: 30000,
  }

  const messages: ConnectorMessage[] = [
    {
      role: 'system',
      content: `あなたはAIモデル評価プラットフォームのアシスタントです。
ユーザーのヒアリング回答から、構造化されたユースケースプロファイルをJSON形式で出力してください。
必ず以下の形式のJSONのみを出力してください。他のテキストは不要です。`,
    },
    {
      role: 'user',
      content: `以下のヒアリング回答からユースケースプロファイルを生成してください。

Q1. AIの用途: ${answers.q1_useCase}
Q2. 対象ユーザー: ${answers.q2_audience}
Q3. 重視する性格: ${answers.q3_priorities.join(', ')}
Q4. 業界・ドメイン: ${answers.q4_domain}
Q5. 外せないポイント/NG: ${answers.q5_constraints}

出力形式:
{
  "domain": "業界/用途の短い説明",
  "audience": "対象ユーザーの説明",
  "priority": ["accuracy", "tone" 等、重視する評価軸の英語名配列],
  "constraints": ["制約条件の配列"],
  "risk_factors": ["リスク要因の配列"],
  "output_format": "期待する出力形式",
  "language": "主要言語"
}`,
    },
  ]

  const response = await connector.send(messages, config)
  const profile = parseJsonResponse<UseCaseProfile>(response.content)

  if (!profile) {
    // Retry once
    const retryResponse = await connector.send(messages, config)
    const retryProfile = parseJsonResponse<UseCaseProfile>(retryResponse.content)
    if (!retryProfile) throw new Error('ユースケースプロファイルの生成に失敗しました')
    return retryProfile
  }

  return profile
}

// ============================================================
// Stage 2: Category Distribution (ルールベース、LLM不使用)
// ============================================================

const BASE_DISTRIBUTION: CategoryDistribution = {
  ACCURACY: 4,
  RELEVANCE: 3,
  CONCISENESS: 3,
  TONE: 3,
  INSTRUCTION: 4,
  EDGE_CASE: 3,
  GENERAL: 0,
}

const PRIORITY_TO_CATEGORY: Record<string, PromptCategory> = {
  '正確さ重視': 'ACCURACY',
  'accuracy': 'ACCURACY',
  '関連性': 'RELEVANCE',
  'relevance': 'RELEVANCE',
  '簡潔さ重視': 'CONCISENESS',
  'conciseness': 'CONCISENESS',
  '丁寧さ重視': 'TONE',
  'tone': 'TONE',
  'スピード重視': 'INSTRUCTION',
  'instruction': 'INSTRUCTION',
  '創造性重視': 'EDGE_CASE',
  'creativity': 'EDGE_CASE',
}

export function computeCategoryDistribution(
  priorities: string[]
): CategoryDistribution {
  const dist = { ...BASE_DISTRIBUTION }
  const total = 20

  // Map priorities to categories
  const priorityCategories: PromptCategory[] = priorities
    .map(p => PRIORITY_TO_CATEGORY[p.toLowerCase()] || PRIORITY_TO_CATEGORY[p])
    .filter((c): c is PromptCategory => !!c)

  if (priorityCategories.length === 0) return dist

  // priority に指定された軸は+2問
  for (const cat of priorityCategories) {
    dist[cat] += 2
  }

  // それ以外の軸から-1問ずつ調整して合計20に
  const currentTotal = Object.values(dist).reduce((a, b) => a + b, 0)
  let excess = currentTotal - total
  const nonPriority = (Object.keys(dist) as PromptCategory[])
    .filter(k => !priorityCategories.includes(k) && dist[k] > 1)

  let i = 0
  while (excess > 0 && nonPriority.length > 0) {
    const cat = nonPriority[i % nonPriority.length]
    if (dist[cat] > 1) {
      dist[cat]--
      excess--
    }
    i++
    if (i > 100) break // safety
  }

  return dist
}

// ============================================================
// Stage 3: Prompt Generation (LLM 1回)
// ============================================================

export async function generatePromptSet(
  profile: UseCaseProfile,
  distribution: CategoryDistribution,
  userId: string
): Promise<GeneratedPrompt[]> {
  const selected = await selectCheapModel(userId)
  if (!selected) throw new Error('利用可能なAPIキーがありません')

  const connector = getConnector(selected.provider)
  const config: ConnectorConfig = {
    provider: selected.provider,
    model: selected.model,
    apiKey: selected.apiKey,
    maxTokens: 4096,
    temperature: 0.7,
    timeoutMs: 60000,
  }

  const seeds = getSeedPrompts(profile.domain)
  const seedText = seeds
    .map((s, i) => `  ${i + 1}. [${s.category}] ${s.prompt}`)
    .join('\n')

  const distText = (Object.entries(distribution) as [PromptCategory, number][])
    .filter(([, count]) => count > 0)
    .map(([cat, count]) => `  - ${cat}: ${count}問`)
    .join('\n')

  const messages: ConnectorMessage[] = [
    {
      role: 'system',
      content: `あなたはAI評価用プロンプトの専門家です。
ユースケースプロファイルとカテゴリ配分に基づき、評価用プロンプトセットをJSON配列で生成してください。
JSONの配列のみを出力してください。他のテキストは不要です。`,
    },
    {
      role: 'user',
      content: `以下のユースケースに対する評価用プロンプトを合計20問生成してください。

## ユースケースプロファイル
${JSON.stringify(profile, null, 2)}

## カテゴリ別配分
${distText}

## 参考シードプロンプト（これらを参考にしつつ、残りを独自に生成）
${seedText}

## 出力形式（JSON配列）
[
  {
    "id": "p01",
    "category": "ACCURACY",
    "prompt": "実際のプロンプト文",
    "evaluation_focus": "何を評価するかの1文説明",
    "gold_standard_hint": "理想的な回答の方向性（採点の参考用）"
  }
]

注意:
- 各カテゴリの問数を配分通りに合わせてください
- プロンプトは具体的で、モデルの差が出やすいものにしてください
- gold_standard_hint はジャッジモデルの参考用（ユーザーには非表示）
- 日本語で生成してください
- id は p01, p02, ... のように連番`,
    },
  ]

  const response = await connector.send(messages, config)
  let prompts = parseJsonResponse<GeneratedPrompt[]>(response.content)

  if (!prompts || !Array.isArray(prompts)) {
    // Retry once
    const retryResponse = await connector.send(messages, config)
    prompts = parseJsonResponse<GeneratedPrompt[]>(retryResponse.content)
    if (!prompts || !Array.isArray(prompts)) {
      throw new Error('プロンプトセットの生成に失敗しました')
    }
  }

  // Quality guardrails
  prompts = prompts.filter(p => {
    if (!p.prompt || p.prompt.length < 10) return false
    if (p.prompt.length > 500) return false
    return true
  })

  return prompts
}

// ============================================================
// JSON Parser (reused from step1-extractor.ts pattern)
// ============================================================

function parseJsonResponse<T>(raw: string): T | null {
  try {
    // Remove markdown code fences
    const cleaned = raw
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}
