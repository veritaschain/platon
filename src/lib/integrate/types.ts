export type Stance = 'agree' | 'disagree' | 'neutral' | 'conditional'
export type Confidence = 'high' | 'medium' | 'low'
export type EvidenceType = 'data' | 'logic' | 'authority' | 'experience' | 'none'
export type BiasType = 'optimistic' | 'pessimistic' | 'balanced'
export type Specificity = 'high' | 'medium' | 'low'
export type ConflictType = 'premise_diff' | 'claim_contradiction' | 'risk_disagreement'

export interface Claim {
  content: string
  confidence: Confidence
  evidence_type: EvidenceType
}

export interface Extraction {
  modelName: string
  stance: Stance
  premises: string[]
  claims: Claim[]
  risks: string[]
  specificity: Specificity
  bias_tendency: BiasType
}

export interface Conflict {
  type: ConflictType
  description: string
  sources: string[]
}

export interface WeightedClaim extends Claim {
  modelName: string
  scores: {
    consistency: number
    specificity: number
    evidenceStrength: number
    counterResistance: number
  }
  compositeWeight: number
}

export interface TrustStructure {
  highTrust: WeightedClaim[]
  conditional: WeightedClaim[]
  uncertain: WeightedClaim[]
}

export interface IntegrateInput {
  userMessageId: string
  responses: { modelName: string; content: string }[]
  debateResults?: { modelName: string; content: string }[]
}

export interface IntegrateOutput {
  step1Extractions: Extraction[]
  step15TrustStructure: TrustStructure
  step15Conflicts: Conflict[]
  step2Prompt: string
  step2Output: string
  fallbackUsed: boolean
}
