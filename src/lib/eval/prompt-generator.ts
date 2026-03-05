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
// Stage 1: Hearing → UseCaseProfile (ルールベース、LLM不使用)
// ============================================================

const PRIORITY_MAP: Record<string, string> = {
  '正確さ重視': 'accuracy',
  'スピード重視': 'speed',
  '丁寧さ重視': 'tone',
  '創造性重視': 'creativity',
  '簡潔さ重視': 'conciseness',
}

export function generateUseCaseProfile(
  answers: HearingAnswers,
): UseCaseProfile {
  const domain = [answers.q4_domain, answers.q1_useCase].filter(Boolean).join(' / ') || '一般'
  const priorities = (answers.q3_priorities || []).map(p => PRIORITY_MAP[p] || p)
  const constraints = answers.q5_constraints
    ? answers.q5_constraints.split(/[、,\n]/).map(s => s.trim()).filter(Boolean)
    : []

  return {
    domain,
    audience: answers.q2_audience || '一般ユーザー',
    priority: priorities.length > 0 ? priorities : ['accuracy'],
    constraints,
    risk_factors: constraints.length > 0
      ? [`制約違反: ${constraints[0]}`]
      : ['不正確な情報提供'],
    output_format: '自然文',
    language: '日本語',
  }
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

// Generate a batch of prompts for specific categories (5 prompts max per call)
export async function generatePromptBatch(
  profile: UseCaseProfile,
  categories: { category: PromptCategory; count: number }[],
  userId: string,
  batchIndex: number,
): Promise<GeneratedPrompt[]> {
  const selected = await selectCheapModel(userId)
  if (!selected) throw new Error('利用可能なAPIキーがありません')

  const connector = getConnector(selected.provider)
  const config: ConnectorConfig = {
    provider: selected.provider,
    model: selected.model,
    apiKey: selected.apiKey,
    maxTokens: 2048,
    temperature: 0.7,
    timeoutMs: 25000,
  }

  const totalInBatch = categories.reduce((s, c) => s + c.count, 0)
  const seeds = getSeedPrompts(profile.domain)
  const seedText = seeds.slice(0, 2)
    .map((s, i) => `  ${i + 1}. [${s.category}] ${s.prompt}`)
    .join('\n')

  const catText = categories
    .map(c => `${c.category}: ${c.count}問`)
    .join(', ')

  const messages: ConnectorMessage[] = [
    {
      role: 'user',
      content: `AI評価用プロンプトを${totalInBatch}問、JSON配列で生成してください。JSONのみ出力。

ドメイン: ${profile.domain} / 対象: ${profile.audience}
制約: ${profile.constraints.join(', ') || 'なし'}
カテゴリ配分: ${catText}

参考: ${seedText}

[{"id":"p${String(batchIndex * 5 + 1).padStart(2, '0')}","category":"ACCURACY","prompt":"質問文","evaluation_focus":"評価ポイント","gold_standard_hint":"理想回答の方向性"}]

日本語で、具体的に。`,
    },
  ]

  const response = await connector.send(messages, config)
  let prompts = parseJsonResponse<GeneratedPrompt[]>(response.content)

  if (!prompts || !Array.isArray(prompts)) {
    const retryResponse = await connector.send(messages, config)
    prompts = parseJsonResponse<GeneratedPrompt[]>(retryResponse.content)
    if (!prompts || !Array.isArray(prompts)) {
      throw new Error('プロンプト生成に失敗しました')
    }
  }

  return prompts.filter(p => p.prompt && p.prompt.length >= 10 && p.prompt.length <= 500)
}

// Split distribution into batches of ~5 prompts each
export function splitIntoBatches(
  distribution: CategoryDistribution
): { category: PromptCategory; count: number }[][] {
  const entries = (Object.entries(distribution) as [PromptCategory, number][])
    .filter(([, count]) => count > 0)

  const batches: { category: PromptCategory; count: number }[][] = []
  let currentBatch: { category: PromptCategory; count: number }[] = []
  let currentCount = 0

  for (const [category, count] of entries) {
    if (currentCount + count > 5 && currentBatch.length > 0) {
      batches.push(currentBatch)
      currentBatch = []
      currentCount = 0
    }
    currentBatch.push({ category, count })
    currentCount += count

    if (currentCount >= 5) {
      batches.push(currentBatch)
      currentBatch = []
      currentCount = 0
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
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
