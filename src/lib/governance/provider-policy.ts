import { maskPII } from './pii-masker'

const BLOCKED_PATTERNS = [
  /CONFIDENTIAL/i,
  /社外秘/,
  /極秘/,
  /INTERNAL USE ONLY/i,
  /DO NOT DISTRIBUTE/i,
]

export function checkProviderPolicy(content: string): { blocked: boolean; reason?: string; piiDetected: boolean } {
  // Check for confidentiality markers
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      return { blocked: true, reason: `機密文書マーカーが検出されました: ${pattern.source}`, piiDetected: false }
    }
  }

  // Check for PII (warn but don't block — content will be masked before sending)
  const maskResult = maskPII(content)
  if (maskResult.maskCount > 0) {
    return { blocked: false, piiDetected: true }
  }

  return { blocked: false, piiDetected: false }
}
