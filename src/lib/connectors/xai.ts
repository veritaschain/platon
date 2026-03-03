import OpenAI from 'openai'
import type { BaseConnector, ConnectorConfig, ConnectorMessage, ConnectorResponse } from './types'
import { MODEL_PRICING } from './types'
import { formatOpenAIMessages } from './format-helpers'

export class XAIConnector implements BaseConnector {
  async send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse> {
    const timeoutMs = cfg.timeoutMs ?? 8000
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: 'https://api.x.ai/v1',
      maxRetries: 0,
      timeout: timeoutMs,
    })
    const start = Date.now()

    const apiCall = client.chat.completions.create({
      model: cfg.model,
      messages: formatOpenAIMessages(msgs) as any,
      max_tokens: cfg.maxTokens ?? 4096,
      temperature: cfg.temperature ?? 0.7,
    })

    // 二重安全弁: SDK timeout + 手動 Promise.race
    const hardTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`xAI timeout after ${timeoutMs}ms`)), timeoutMs)
    )

    const res = await Promise.race([apiCall, hardTimeout])
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
      const client = new OpenAI({
        apiKey: key,
        baseURL: 'https://api.x.ai/v1',
        maxRetries: 0,
        timeout: 8000,
      })
      await client.chat.completions.create({
        model: 'grok-4-fast-non-reasoning',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      })
      return true
    } catch (e: any) {
      if (e?.status === 401 || e?.status === 403) return false
      if (e?.error?.code === 'invalid_api_key') return false
      // 401/403 以外のエラー（レートリミット等）はキー自体は有効
      return true
    }
  }
}
