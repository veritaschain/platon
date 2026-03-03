import type { NormalizedModelScores, WeightPreset, RankingEntry, ScoreMatrixEntry } from './types'

// ============================================================
// Default weight presets (CLAUDE.md §4.4)
// ============================================================

const WEIGHT_PRESETS: Record<string, WeightPreset> = {
  'balanced': {
    accuracy: 0.15, relevance: 0.15, conciseness: 0.15,
    tone: 0.10, instruction: 0.15, latency: 0.15, cost: 0.15,
  },
  '正確さ重視': {
    accuracy: 0.25, relevance: 0.15, conciseness: 0.10,
    tone: 0.10, instruction: 0.15, latency: 0.10, cost: 0.15,
  },
  '丁寧さ重視': {
    accuracy: 0.15, relevance: 0.15, conciseness: 0.10,
    tone: 0.25, instruction: 0.10, latency: 0.10, cost: 0.15,
  },
  'スピード重視': {
    accuracy: 0.15, relevance: 0.15, conciseness: 0.15,
    tone: 0.05, instruction: 0.10, latency: 0.25, cost: 0.15,
  },
  '簡潔さ重視': {
    accuracy: 0.15, relevance: 0.15, conciseness: 0.25,
    tone: 0.05, instruction: 0.15, latency: 0.10, cost: 0.15,
  },
}

export function getDefaultWeights(priorities: string[]): WeightPreset {
  // Try to match a preset
  for (const p of priorities) {
    if (WEIGHT_PRESETS[p]) return WEIGHT_PRESETS[p]
  }
  return WEIGHT_PRESETS['balanced']
}

export function computeWeightedRanking(
  normalizedScores: NormalizedModelScores[],
  weights: WeightPreset
): RankingEntry[] {
  const ranked = normalizedScores.map(scores => {
    const totalScore =
      scores.accuracy * weights.accuracy +
      scores.relevance * weights.relevance +
      scores.conciseness * weights.conciseness +
      scores.tone * weights.tone +
      scores.instructionFollowing * weights.instruction +
      scores.latency * weights.latency +
      scores.cost * weights.cost

    return {
      rank: 0,
      model: scores.model,
      provider: scores.provider,
      totalScore: Math.round(totalScore * 100) / 100,
      normalizedScores: scores,
    }
  })

  // Sort by total score descending
  ranked.sort((a, b) => b.totalScore - a.totalScore)

  // Assign ranks
  ranked.forEach((entry, i) => {
    entry.rank = i + 1
  })

  return ranked
}

export function buildScoreMatrix(
  normalizedScores: NormalizedModelScores[]
): ScoreMatrixEntry[] {
  return normalizedScores.map(scores => ({
    model: scores.model,
    provider: scores.provider,
    metrics: {
      accuracy: Math.round(scores.accuracy * 10) / 10,
      relevance: Math.round(scores.relevance * 10) / 10,
      conciseness: Math.round(scores.conciseness * 10) / 10,
      tone: Math.round(scores.tone * 10) / 10,
      instructionFollowing: Math.round(scores.instructionFollowing * 10) / 10,
      latency: Math.round(scores.latency * 10) / 10,
      cost: Math.round(scores.cost * 10) / 10,
      errorRate: Math.round(scores.errorRate * 10) / 10,
      formatCompliance: Math.round(scores.formatCompliance * 10) / 10,
      quality: Math.round(scores.quality * 10) / 10,
    },
  }))
}
