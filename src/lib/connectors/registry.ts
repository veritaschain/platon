import type { BaseConnector, Provider } from './types'
import { OpenAIConnector } from './openai'
import { AnthropicConnector } from './anthropic'
import { GoogleConnector } from './google'
import { XAIConnector } from './xai'

const connectors: Record<Provider, BaseConnector> = {
  OPENAI: new OpenAIConnector(),
  ANTHROPIC: new AnthropicConnector(),
  GOOGLE: new GoogleConnector(),
  XAI: new XAIConnector(),
}

export function getConnector(provider: Provider): BaseConnector {
  return connectors[provider]
}

export { connectors }
