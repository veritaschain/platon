import { create } from 'zustand'

export interface ModelRun {
  id: string
  model: string
  provider: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT'
  inputTokens?: number
  outputTokens?: number
  estimatedCostUsd?: number
  latencyMs?: number
  piiMasked: boolean
  assistantMessage?: { id: string; content: string }
  handoffInfo?: { sourceModelRunId: string; templateType: string }
}

export interface UserMessage {
  id: string
  roomId: string
  content: string
  mode?: string
  orderIndex: number
  modelRuns: ModelRun[]
  integrateResult?: IntegrateResult | null
}

export interface IntegrateResult {
  id: string
  step1Extractions: unknown[]
  step15TrustStructure: {
    highTrust: unknown[]
    conditional: unknown[]
    uncertain: unknown[]
  }
  step15Conflicts: unknown[]
  step2Output: string
  fallbackUsed: boolean
}

interface MessageStore {
  messages: UserMessage[]
  isLoading: boolean
  isSending: boolean
  setMessages: (messages: UserMessage[]) => void
  sendMessage: (roomId: string, content: string, mode?: string, targetModels?: string[]) => Promise<void>
  executeIntegrate: (userMessageId: string, roomId: string) => Promise<void>
  updateIntegrateResult: (userMessageId: string, result: IntegrateResult) => void
  pollRunStatus: (userMessageId: string) => Promise<void>
  retryRun: (userMessageId: string, roomId: string, content: string, mode?: string, targetModels?: string[]) => Promise<void>
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  isLoading: false,
  isSending: false,

  setMessages: (messages) => set({ messages }),

  sendMessage: async (roomId, content, mode, targetModels) => {
    set({ isSending: true })

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const tempMsg: UserMessage = {
      id: tempId,
      roomId,
      content,
      mode,
      orderIndex: get().messages.length,
      modelRuns: [],
    }
    set(s => ({ messages: [...s.messages, tempMsg] }))

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, content, mode, targetModels }),
      })

      let data: Record<string, unknown>
      try {
        data = await res.json()
      } catch {
        throw new Error(`サーバーから不正なレスポンスが返されました (status: ${res.status})`)
      }

      if (!res.ok || !data.userMessageId) {
        console.error('[sendMessage] API error:', data.error ?? data)
        set(s => ({
          messages: s.messages.map(m =>
            m.id === tempId ? {
              ...m,
              modelRuns: [{
                id: 'error',
                model: '',
                provider: '',
                status: 'FAILED' as const,
                piiMasked: false,
                assistantMessage: { id: 'error', content: (data.error as string) ?? 'メッセージの送信に失敗しました' },
              }],
            } : m
          ),
          isSending: false,
        }))
        return
      }

      const { userMessageId, runs } = data as { userMessageId: string; runs?: ModelRun[] }

      if (Array.isArray(runs) && runs.length > 0) {
        // New format: runs included in response (no second fetch needed)
        set(s => ({
          messages: s.messages.map(m =>
            m.id === tempId ? { ...m, id: userMessageId, modelRuns: runs } : m
          ),
          isSending: false,
        }))

        // Auto-integrate for multi mode (fire-and-forget)
        const completedRuns = runs.filter(r => r.status === 'COMPLETED')
        if (mode === 'multi' && completedRuns.length >= 2) {
          get().executeIntegrate(userMessageId, roomId)
        }
      } else {
        // Legacy format: fetch runs separately
        const runsRes = await fetch(`/api/messages/${userMessageId}/runs`)
        const fetchedRuns = await runsRes.json()
        set(s => ({
          messages: s.messages.map(m =>
            m.id === tempId ? { ...m, id: userMessageId, modelRuns: Array.isArray(fetchedRuns) ? fetchedRuns : [] } : m
          ),
          isSending: false,
        }))

        const completedRuns = Array.isArray(fetchedRuns) ? fetchedRuns.filter((r: ModelRun) => r.status === 'COMPLETED') : []
        if (mode === 'multi' && completedRuns.length >= 2) {
          get().executeIntegrate(userMessageId, roomId)
        }
      }
    } catch (err) {
      console.error('[sendMessage] unexpected error:', err)
      set(s => ({
        messages: s.messages.map(m =>
          m.id === tempId ? {
            ...m,
            modelRuns: [{
              id: 'error',
              model: '',
              provider: '',
              status: 'FAILED' as const,
              piiMasked: false,
              assistantMessage: { id: 'error', content: '通信エラーが発生しました' },
            }],
          } : m
        ),
        isSending: false,
      }))
    }
  },

  executeIntegrate: async (userMessageId, roomId) => {
    try {
      const res = await fetch('/api/handoffs/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId, roomId }),
      })
      const data = await res.json()
      if (data.output) {
        get().updateIntegrateResult(userMessageId, data.output)
      }
    } catch (err) {
      console.error('[executeIntegrate]', err)
    }
  },

  updateIntegrateResult: (userMessageId, result) => {
    set(s => ({
      messages: s.messages.map(m =>
        m.id === userMessageId ? { ...m, integrateResult: result } : m
      ),
    }))
  },

  pollRunStatus: async (userMessageId) => {
    try {
      const res = await fetch(`/api/messages/${userMessageId}/runs`)
      if (!res.ok) return
      const runs = await res.json()
      if (!Array.isArray(runs)) return

      set(s => ({
        messages: s.messages.map(m =>
          m.id === userMessageId ? { ...m, modelRuns: runs } : m
        ),
      }))
    } catch (err) {
      console.error('[pollRunStatus]', err)
    }
  },

  retryRun: async (userMessageId, roomId, content, mode, targetModels) => {
    // Remove the failed message and resend
    set(s => ({
      messages: s.messages.filter(m => m.id !== userMessageId),
    }))
    await get().sendMessage(roomId, content, mode, targetModels)
  },
}))
