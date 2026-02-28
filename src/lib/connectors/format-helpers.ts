import type { ConnectorMessage } from './types'

/**
 * Convert ConnectorMessage[] into OpenAI-compatible message format.
 * When images are present on a user message, converts content from string
 * to the multi-part content array format required by OpenAI/XAI Vision APIs.
 */
export function formatOpenAIMessages(msgs: ConnectorMessage[]) {
  return msgs.map(msg => {
    if (msg.images && msg.images.length > 0 && msg.role === 'user') {
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }
      > = []

      if (msg.content) {
        parts.push({ type: 'text', text: msg.content })
      }

      for (const img of msg.images) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
            detail: 'auto',
          },
        })
      }

      return { role: msg.role, content: parts }
    }

    return { role: msg.role, content: msg.content }
  })
}
