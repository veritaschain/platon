import type { Extraction, WeightedClaim } from '../types'

const SPECIFICITY_SCORE: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 }
const EVIDENCE_SCORE: Record<string, number> = { data: 1.0, logic: 0.7, authority: 0.5, experience: 0.3, none: 0.1 }

function claimSimilarity(a: string, b: string): boolean {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  const minLen = Math.min(30, Math.min(la.length, lb.length))
  return la.includes(lb.slice(0, minLen)) || lb.includes(la.slice(0, minLen))
}

export function weightClaims(extractions: Extraction[], debateResults?: { modelName: string; content: string }[]): WeightedClaim[] {
  const allClaims: WeightedClaim[] = []

  for (const extraction of extractions) {
    for (const claim of extraction.claims) {
      // Consistency: 同一内容が他AIにも存在するか（改善されたマッチング）
      const similarCount = extractions.filter(e =>
        e.modelName !== extraction.modelName &&
        e.claims.some(c => claimSimilarity(c.content, claim.content))
      ).length
      const consistency = similarCount / Math.max(extractions.length - 1, 1)

      const specificity = SPECIFICITY_SCORE[extraction.specificity] ?? 0.5
      const evidenceStrength = EVIDENCE_SCORE[claim.evidence_type] ?? 0.1

      // Counter resistance: ディベートで維持された主張に加点（改善されたマッチング）
      const counterResistance = debateResults
        ? debateResults.some(d => claimSimilarity(d.content, claim.content)) ? 0.8 : 0.3
        : 0.5

      const compositeWeight =
        consistency * 0.3 + specificity * 0.2 + evidenceStrength * 0.3 + counterResistance * 0.2

      allClaims.push({
        ...claim,
        modelName: extraction.modelName,
        scores: { consistency, specificity, evidenceStrength, counterResistance },
        compositeWeight,
      })
    }
  }

  return allClaims.sort((a, b) => b.compositeWeight - a.compositeWeight)
}
