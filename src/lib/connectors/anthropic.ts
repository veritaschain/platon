import Anthropic from '@anthropic-ai/sdk'
import type { BaseConnector, ConnectorConfig, ConnectorMessage, ConnectorResponse } from './types'
import { MODEL_PRICING } from './types'

export class AnthropicConnector implements BaseConnector {
  async send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse> {
    const client = new Anthropic({ apiKey: cfg.apiKey })
    const start = Date.now()
    const timeoutMs = cfg.timeoutMs ?? 30000
    const userMsgs = msgs.filter(m => m.role !== 'system')
    const systemMsg = msgs.find(m => m.role === 'system')?.content

    const apiCall = client.messages.create({
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 4096,
      messages: userMsgs as { role: 'user' | 'assistant'; content: string }[],
      ...(systemMsg ? { system: systemMsg } : {}),
    })

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Anthropic timeout after ${timeoutMs}ms`)), timeoutMs)
    )

    const res = await Promise.race([apiCall, timeout])
    return {
      content: res.content[0]?.type === 'text' ? res.content[0].text : '',
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
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
      const client = new Anthropic({ apiKey: key })
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      })
      return true
    } catch (err: any) {
      // 認証エラー以外（rate limitなど）はキーが有効とみなす
      if (err?.status === 401) return false
      return true
    }
  }
}
