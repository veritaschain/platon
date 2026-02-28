import { create } from 'zustand'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'

interface ApiKeyInfo {
  id: string
  provider: string
  keyHint: string
  isActive: boolean
}

interface ConnectorStore {
  availableModels: typeof SUPPORTED_MODELS
  selectedModels: string[]
  apiKeys: ApiKeyInfo[]
  advancedMode: boolean
  fetchApiKeys: () => Promise<void>
  addApiKey: (provider: string, apiKey: string) => Promise<boolean>
  removeApiKey: (id: string) => Promise<void>
  testApiKey: (provider: string, apiKey: string) => Promise<boolean>
  toggleModel: (model: string) => void
  setAdvancedMode: (v: boolean) => void
}

export const useConnectorStore = create<ConnectorStore>((set, get) => ({
  availableModels: SUPPORTED_MODELS,
  selectedModels: ['gpt-4o'],
  apiKeys: [],
  advancedMode: true,

  fetchApiKeys: async () => {
    const res = await fetch('/api/connectors/keys')
    const keys = await res.json()
    set({ apiKeys: Array.isArray(keys) ? keys : [] })
  },

  addApiKey: async (provider, apiKey) => {
    const res = await fetch('/api/connectors/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    })
    if (res.ok) {
      await get().fetchApiKeys()
      return true
    }
    return false
  },

  removeApiKey: async (id) => {
    await fetch(`/api/connectors/keys/${id}`, { method: 'DELETE' })
    await get().fetchApiKeys()
  },

  testApiKey: async (provider, apiKey) => {
    const res = await fetch('/api/connectors/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    })
    const { valid } = await res.json()
    return valid
  },

  toggleModel: (model) => {
    set(s => {
      const selected = s.selectedModels.includes(model)
        ? s.selectedModels.filter(m => m !== model)
        : s.selectedModels.length < 3 ? [...s.selectedModels, model] : s.selectedModels
      return { selectedModels: selected }
    })
  },

  setAdvancedMode: (v) => set({ advancedMode: v }),
}))
