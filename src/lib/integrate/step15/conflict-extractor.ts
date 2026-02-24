import type { Extraction, Conflict } from '../types'

export function extractConflicts(extractions: Extraction[]): Conflict[] {
  const conflicts: Conflict[] = []

  // Premise差分
  if (extractions.length > 1) {
    const allPremises = extractions.flatMap(e => e.premises)
    const premiseMap: Record<string, string[]> = {}
    for (const e of extractions) {
      for (const p of e.premises) {
        if (!premiseMap[p]) premiseMap[p] = []
        premiseMap[p].push(e.modelName)
      }
    }
    const uniquePremises = Object.entries(premiseMap).filter(([, models]) => models.length < extractions.length)
    if (uniquePremises.length > 0) {
      conflicts.push({
        type: 'premise_diff',
        description: `前提の違い: ${uniquePremises.slice(0, 3).map(([p]) => p).join(', ')}`,
        sources: [...new Set(uniquePremises.flatMap(([, models]) => models))],
      })
    }
  }

  // Stance矛盾
  const stances = extractions.map(e => e.stance)
  const hasAgree = stances.includes('agree')
  const hasDisagree = stances.includes('disagree')
  if (hasAgree && hasDisagree) {
    conflicts.push({
      type: 'claim_contradiction',
      description: '賛成と反対の立場が混在しています',
      sources: extractions.map(e => e.modelName),
    })
  }

  // Bias偏り
  const biases = extractions.map(e => e.bias_tendency)
  if (new Set(biases).size > 1) {
    conflicts.push({
      type: 'risk_disagreement',
      description: `楽観/悲観の評価が分かれています (${biases.join(', ')})`,
      sources: extractions.map(e => e.modelName),
    })
  }

  return conflicts
}
