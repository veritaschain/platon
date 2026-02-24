import type { Extraction } from './types'
import type { ConnectorMessage } from '@/lib/connectors/types'

export function buildExtractionPrompt(response: string): ConnectorMessage[] {
  return [{
    role: 'user',
    content: `以下の回答を、指定されたJSON形式で構造化してください。
回答以外のテキストは一切出力しないでください。JSONのみ出力してください。

{
  "stance": "agree" | "disagree" | "neutral" | "conditional",
  "premises": ["この回答が前提としている事実や仮定"],
  "claims": [
    {
      "content": "主張の内容",
      "confidence": "high" | "medium" | "low",
      "evidence_type": "data" | "logic" | "authority" | "experience" | "none"
    }
  ],
  "risks": ["指摘されているリスクや懸念"],
  "specificity": "high" | "medium" | "low",
  "bias_tendency": "optimistic" | "pessimistic" | "balanced"
}

---
${response}`,
  }]
}

export function parseExtraction(raw: string, modelName: string): Extraction | null {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return { ...parsed, modelName }
  } catch {
    return null
  }
}
