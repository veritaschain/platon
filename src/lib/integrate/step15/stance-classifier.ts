import type { Extraction, Stance } from '../types'

export function classifyStances(extractions: Extraction[]) {
  const distribution: Record<Stance, string[]> = {
    agree: [], disagree: [], neutral: [], conditional: [],
  }
  for (const e of extractions) {
    distribution[e.stance].push(e.modelName)
  }
  const maxCount = Math.max(...Object.values(distribution).map(v => v.length))
  const consensus = maxCount === extractions.length
  return { consensus, distribution }
}
