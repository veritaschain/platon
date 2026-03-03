import type { ModelResponse, JudgeScore } from '@prisma/client'
import type { NormalizedModelScores } from './types'
import type { Provider } from '@/lib/connectors/types'

interface ResponseWithScore extends ModelResponse {
  judgeScore: JudgeScore | null
}

interface ModelMetrics {
  model: string
  provider: Provider
  latencyMedian: number
  latencyP95: number
  totalCost: number
  errorRate: number
  formatCompliance: number
  avgAccuracy: number
  avgRelevance: number
  avgConciseness: number
  avgTone: number
  avgInstructionFollowing: number
  responseCount: number
}

export function calculateObjectiveMetrics(
  responses: ResponseWithScore[],
  models: string[]
): Map<string, ModelMetrics> {
  const metricsMap = new Map<string, ModelMetrics>()

  for (const model of models) {
    const modelResponses = responses.filter(r => r.model === model)
    if (modelResponses.length === 0) continue

    const completed = modelResponses.filter(r => r.status === 'COMPLETED')
    const failed = modelResponses.filter(r =>
      r.status === 'FAILED' || r.status === 'TIMEOUT' || r.status === 'REFUSED'
    )

    // Latency (only completed responses)
    const latencies = completed
      .map(r => r.latencyMs)
      .filter((l): l is number => l !== null)
      .sort((a, b) => a - b)

    const latencyMedian = latencies.length > 0
      ? latencies[Math.floor(latencies.length / 2)]
      : 0
    const latencyP95 = latencies.length > 0
      ? latencies[Math.floor(latencies.length * 0.95)]
      : 0

    // Cost
    const totalCost = modelResponses.reduce(
      (sum, r) => sum + Number(r.estimatedCostUsd ?? 0),
      0
    )

    // Error rate
    const errorRate = modelResponses.length > 0
      ? failed.length / modelResponses.length
      : 0

    // Format compliance (simple check: non-empty content)
    const formatCompliance = modelResponses.length > 0
      ? completed.filter(r => r.content.trim().length > 0).length / modelResponses.length
      : 0

    // Judge scores (averages)
    const scored = completed
      .map(r => r.judgeScore)
      .filter((s): s is JudgeScore => s !== null)

    const avgScore = (field: keyof Pick<JudgeScore, 'accuracy' | 'relevance' | 'conciseness' | 'tone' | 'instructionFollowing'>) =>
      scored.length > 0
        ? scored.reduce((sum, s) => sum + s[field], 0) / scored.length
        : 0

    metricsMap.set(model, {
      model,
      provider: modelResponses[0].provider as Provider,
      latencyMedian,
      latencyP95,
      totalCost,
      errorRate,
      formatCompliance,
      avgAccuracy: avgScore('accuracy'),
      avgRelevance: avgScore('relevance'),
      avgConciseness: avgScore('conciseness'),
      avgTone: avgScore('tone'),
      avgInstructionFollowing: avgScore('instructionFollowing'),
      responseCount: modelResponses.length,
    })
  }

  return metricsMap
}

export function normalizeScores(
  metricsMap: Map<string, ModelMetrics>
): NormalizedModelScores[] {
  const allMetrics = Array.from(metricsMap.values())
  if (allMetrics.length === 0) return []

  // Find min/max for normalization
  const latencies = allMetrics.map(m => m.latencyMedian).filter(l => l > 0)
  const costs = allMetrics.map(m => m.totalCost).filter(c => c > 0)
  const minLatency = Math.min(...latencies, 1)
  const maxLatency = Math.max(...latencies, 1)
  const minCost = Math.min(...costs, 0.0001)
  const maxCost = Math.max(...costs, 0.0001)

  return allMetrics.map(m => {
    // Quality: (5軸平均 / 5) × 10
    const qualityAvg = (m.avgAccuracy + m.avgRelevance + m.avgConciseness + m.avgTone + m.avgInstructionFollowing) / 5
    const quality = (qualityAvg / 5) * 10

    // Latency: 最速を10、最遅を0
    const latencyNorm = maxLatency > minLatency
      ? ((maxLatency - m.latencyMedian) / (maxLatency - minLatency)) * 10
      : 10

    // Cost: 最安を10、最高を0
    const costNorm = maxCost > minCost
      ? ((maxCost - m.totalCost) / (maxCost - minCost)) * 10
      : 10

    // Error rate: (1 - errorRate) × 10
    const errorRateNorm = (1 - m.errorRate) * 10

    // Format compliance: compliance × 10
    const formatComplianceNorm = m.formatCompliance * 10

    return {
      model: m.model,
      provider: m.provider,
      quality,
      accuracy: (m.avgAccuracy / 5) * 10,
      relevance: (m.avgRelevance / 5) * 10,
      conciseness: (m.avgConciseness / 5) * 10,
      tone: (m.avgTone / 5) * 10,
      instructionFollowing: (m.avgInstructionFollowing / 5) * 10,
      latency: Math.max(0, Math.min(10, latencyNorm)),
      cost: Math.max(0, Math.min(10, costNorm)),
      errorRate: Math.max(0, Math.min(10, errorRateNorm)),
      formatCompliance: Math.max(0, Math.min(10, formatComplianceNorm)),
    }
  })
}
