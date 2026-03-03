import { PromptCategory, Provider } from '@prisma/client'

// ============================================================
// Hearing & Profile
// ============================================================

export interface HearingAnswers {
  q1_useCase: string        // Q1: AIを何に使いたいか
  q2_audience: string       // Q2: 対象ユーザー
  q3_priorities: string[]   // Q3: 回答に求める性格（複数選択）
  q4_domain: string         // Q4: 業界・ドメイン
  q5_constraints: string    // Q5: 外せないポイント、NGなこと
}

export interface UseCaseProfile {
  domain: string
  audience: string
  priority: string[]
  constraints: string[]
  risk_factors: string[]
  output_format: string
  language: string
}

// ============================================================
// Prompt Generation
// ============================================================

export type CategoryDistribution = Record<PromptCategory, number>

export interface GeneratedPrompt {
  id: string
  category: string
  prompt: string
  evaluation_focus: string
  gold_standard_hint: string
}

// ============================================================
// Evaluation Engine
// ============================================================

export interface EvalProgressEvent {
  type: 'response_complete' | 'response_error' | 'scoring_start' | 'scoring_complete' | 'report_generating' | 'complete' | 'error'
  model?: string
  promptIndex?: number
  totalPrompts?: number
  totalModels?: number
  completedCount?: number
  totalCount?: number
  message?: string
}

export interface ExecutionResult {
  modelResponseId: string
  provider: Provider
  model: string
  promptItemId: string
  content: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  latencyMs: number
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'REFUSED'
  piiMasked: boolean
}

// ============================================================
// Judge
// ============================================================

export interface JudgeScoreResult {
  accuracy: { score: number; reason: string }
  relevance: { score: number; reason: string }
  conciseness: { score: number; reason: string }
  tone: { score: number; reason: string }
  instruction_following: { score: number; reason: string }
}

// ============================================================
// Score Aggregation
// ============================================================

export interface WeightPreset {
  accuracy: number
  relevance: number
  conciseness: number
  tone: number
  instruction: number
  latency: number
  cost: number
}

export interface NormalizedModelScores {
  model: string
  provider: Provider
  quality: number        // (5軸平均 / 5) × 10
  accuracy: number
  relevance: number
  conciseness: number
  tone: number
  instructionFollowing: number
  latency: number        // 0-10
  cost: number           // 0-10
  errorRate: number      // 0-10
  formatCompliance: number // 0-10
}

export interface RankingEntry {
  rank: number
  model: string
  provider: Provider
  totalScore: number
  normalizedScores: NormalizedModelScores
}

export interface ScoreMatrixEntry {
  model: string
  provider: Provider
  metrics: Record<string, number>
}

export interface HighlightEntry {
  promptItemId: string
  prompt: string
  category: string
  responses: {
    model: string
    content: string
    scores: JudgeScoreResult | null
    totalScore: number
  }[]
  varianceScore: number
}

// ============================================================
// Report
// ============================================================

export interface CostProjectionEntry {
  model: string
  provider: Provider
  costPer1000: number
  medianInputTokens: number
  medianOutputTokens: number
}

export interface EvalReportData {
  rankings: RankingEntry[]
  scoreMatrix: ScoreMatrixEntry[]
  highlights: HighlightEntry[]
  costProjection: CostProjectionEntry[]
  recommendation: string
}
