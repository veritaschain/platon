export type Provider = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'XAI'

export interface ConnectorMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ConnectorConfig {
  provider: Provider
  model: string
  apiKey: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface ConnectorResponse {
  content: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  raw?: unknown
}

export interface BaseConnector {
  send(msgs: ConnectorMessage[], cfg: ConnectorConfig): Promise<ConnectorResponse>
  estimateCost(inTok: number, outTok: number, model: string): number
  validateApiKey(key: string): Promise<boolean>
}

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':                    { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':               { input: 0.15,  output: 0.60  },
  'gpt-4.1-mini':              { input: 0.40,  output: 1.60  },
  'claude-sonnet-4-20250514':  { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'gemini-2.5-flash':          { input: 0.10,  output: 0.40  },
  'gemini-2.5-pro':            { input: 1.25,  output: 5.00  },
  'grok-4':                    { input: 3.00,  output: 15.00 },
}

export const SUPPORTED_MODELS = [
  { provider: 'OPENAI' as Provider,    model: 'gpt-4o',                    label: 'GPT-4o',           tier: 'pro'  },
  { provider: 'OPENAI' as Provider,    model: 'gpt-4o-mini',               label: 'GPT-4o mini',      tier: 'lite' },
  { provider: 'OPENAI' as Provider,    model: 'gpt-4.1-mini',              label: 'GPT-4.1 mini',    tier: 'lite' },
  { provider: 'ANTHROPIC' as Provider, model: 'claude-sonnet-4-20250514',  label: 'Claude Sonnet 4',  tier: 'pro'  },
  { provider: 'ANTHROPIC' as Provider, model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: 'lite' },
  { provider: 'GOOGLE' as Provider,    model: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash', tier: 'lite' },
  { provider: 'GOOGLE' as Provider,    model: 'gemini-2.5-pro',            label: 'Gemini 2.5 Pro',   tier: 'pro'  },
  { provider: 'XAI' as Provider,      model: 'grok-4',                    label: 'Grok-4',           tier: 'pro'  },
]
