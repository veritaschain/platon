export interface MaskResult {
  masked: string
  maskCount: number
  patterns: string[]
}

const PII_PATTERNS = [
  { name: 'EMAIL',   regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { name: 'PHONE_JP', regex: /0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}/g },
  { name: 'PHONE_US', regex: /(\+1[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}/g },
  { name: 'CREDIT_CARD', regex: /\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}/g },
  { name: 'MY_NUMBER', regex: /\d{4}\s?\d{4}\s?\d{4}/g },
]

export function maskPII(text: string): MaskResult {
  let masked = text
  let maskCount = 0
  const patterns: string[] = []
  const counters: Record<string, number> = {}

  for (const { name, regex } of PII_PATTERNS) {
    const matches = masked.match(regex)
    if (matches && matches.length > 0) {
      counters[name] = (counters[name] ?? 0)
      masked = masked.replace(regex, () => {
        counters[name]++
        maskCount++
        return `[${name}_${counters[name]}]`
      })
      patterns.push(name)
    }
  }

  return { masked, maskCount, patterns }
}
