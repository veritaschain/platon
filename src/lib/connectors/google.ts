import { GoogleGenerativeAI } from '@google/generative-ai'
import type { BaseConnector, ConnectorConfig, ConnectorMessage, ConnectorResponse } from './types'
import { MODEL_PRICING } from './types'

export class GoogleConnector implements BaseConnector {
  async send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse> {
    const genAI = new GoogleGenerativeAI(cfg.apiKey)
    const model = genAI.getGenerativeModel({ model: cfg.model })
    const start = Date.now()
    const timeoutMs = cfg.timeoutMs ?? 30000
    const history = msgs.slice(0, -1).filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
    const lastMsg = msgs[msgs.length - 1]
    const chat = model.startChat({ history })

    // Build parts for the last message (may include images)
    const lastParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
    if (lastMsg.images && lastMsg.images.length > 0) {
      for (const img of lastMsg.images) {
        lastParts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } })
      }
    }
    if (lastMsg.content) {
      lastParts.push({ text: lastMsg.content })
    }

    const apiCall = chat.sendMessage(lastParts.length === 1 && 'text' in lastParts[0] ? lastMsg.content : lastParts)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Google timeout after ${timeoutMs}ms`)), timeoutMs)
    )

    const res = await Promise.race([apiCall, timeout])
    const text = res.response.text()
    const usage = res.response.usageMetadata
    return {
      content: text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
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
      const genAI = new GoogleGenerativeAI(key)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      await model.generateContent('Say hi')
      return true
    } catch (e: any) {
      console.error('[Google validateApiKey]', e?.message ?? e)
      if (e?.message?.includes('API_KEY_INVALID') || e?.status === 401 || e?.status === 403) {
        return false
      }
      // モデル廃止・レートリミット等はキー自体の問題ではないので true
      return true
    }
  }
}
