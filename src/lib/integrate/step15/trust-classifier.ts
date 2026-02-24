import type { WeightedClaim, Conflict, TrustStructure } from '../types'

function claimSimilarity(a: string, b: string): boolean {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  // Use longer substring matching (min 30 chars or full content if shorter)
  const minLen = Math.min(30, Math.min(la.length, lb.length))
  return la.includes(lb.slice(0, minLen)) || lb.includes(la.slice(0, minLen))
}

function appearsInAllModels(claim: WeightedClaim, allClaims: WeightedClaim[], totalModels: number): boolean {
  const matchingModels = new Set(
    allClaims.filter(c => claimSimilarity(c.content, claim.content)).map(c => c.modelName)
  )
  return matchingModels.size === totalModels
}

export function classifyTrust(
  weightedClaims: WeightedClaim[],
  conflicts: Conflict[],
  totalModels: number
): TrustStructure {
  const conflictDescriptions = conflicts.map(c => c.description)

  const highTrust: WeightedClaim[] = []
  const conditional: WeightedClaim[] = []
  const uncertain: WeightedClaim[] = []

  for (const claim of weightedClaims) {
    const isConflicted = conflictDescriptions.some(desc =>
      claimSimilarity(desc, claim.content)
    )

    if (isConflicted || claim.compositeWeight < 0.4) {
      uncertain.push(claim)
    } else if (claim.compositeWeight >= 0.7 && appearsInAllModels(claim, weightedClaims, totalModels)) {
      highTrust.push(claim)
    } else {
      conditional.push(claim)
    }
  }

  return { highTrust, conditional, uncertain }
}
