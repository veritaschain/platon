import OpenAI from 'openai'
import type { BaseConnector, ConnectorConfig, ConnectorMessage, ConnectorResponse } from './types'
import { MODEL_PRICING } from './types'

export class OpenAIConnector implements BaseConnector {
  async send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse> {
    const client = new OpenAI({ apiKey: cfg.apiKey })
    const start = Date.now()
    const timeoutMs = cfg.timeoutMs ?? 30000

    const apiCall = client.chat.completions.create({
      model: cfg.model,
      messages: msgs,
      max_tokens: cfg.maxTokens ?? 4096,
      temperature: cfg.temperature ?? 0.7,
    })

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`OpenAI timeout after ${timeoutMs}ms`)), timeoutMs)
    )

    const res = await Promise.race([apiCall, timeout])
    return {
      content: res.choices[0]?.message?.content ?? '',
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    }
  }

  estimateCost(inTok: number, outTok: number, model: string): number {
    const p = MODEL_PRICING[model]
    if (!p) return 0
    return (inTok / 1_000_000) * p.input + (outTok / 1_000_000) * p.output
  }

  async validateApiKey(key: string): Promise<boolean> {
    try {
      const client = new OpenAI({ apiKey: key })
      await client.models.list()
      return true
    } catch { return false }
  }
}
