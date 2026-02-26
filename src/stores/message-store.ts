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

      // Fallback: non-SSE response (error or legacy format)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json()
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
                  assistantMessage: { id: 'error', content: data.error ?? 'メッセージの送信に失敗しました' },
                }],
              } : m
            ),
            isSending: false,
          }))
          return
        }

        // Legacy JSON fallback
        const { userMessageId } = data
        const runsRes = await fetch(`/api/messages/${userMessageId}/runs`)
        const runs = await runsRes.json()
        set(s => ({
          messages: s.messages.map(m =>
            m.id === tempId ? { ...m, id: userMessageId, modelRuns: Array.isArray(runs) ? runs : [] } : m
          ),
          isSending: false,
        }))

        const completedRuns = Array.isArray(runs) ? runs.filter((r: ModelRun) => r.status === 'COMPLETED') : []
        if (mode === 'multi' && completedRuns.length >= 2) {
          await get().executeIntegrate(userMessageId, roomId)
        }
        return
      }

      // --- SSE streaming ---
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let realUserMessageId: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6)
          if (!jsonStr) continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(jsonStr)
          } catch {
            continue
          }

          if (event.type === 'init') {
            realUserMessageId = event.userMessageId as string
            const modelsList = event.models as { provider: string; model: string }[]

            // Replace temp ID with real ID, show all models as RUNNING
            set(s => ({
              messages: s.messages.map(m =>
                m.id === tempId ? {
                  ...m,
                  id: realUserMessageId!,
                  modelRuns: modelsList.map(mdl => ({
                    id: `pending-${mdl.provider}-${mdl.model}`,
                    model: mdl.model,
                    provider: mdl.provider,
                    status: 'RUNNING' as const,
                    piiMasked: false,
                  })),
                } : m
              ),
            }))
          } else if (event.type === 'run') {
            const run = event.run as ModelRun
            const msgId = realUserMessageId ?? tempId

            set(s => ({
              messages: s.messages.map(m => {
                if (m.id !== msgId) return m

                // Find existing placeholder run for this provider+model, or append
                const existingIdx = m.modelRuns.findIndex(
                  r => r.id.startsWith('pending-') && r.provider === run.provider && r.model === run.model
                )

                let newRuns: ModelRun[]
                if (existingIdx >= 0) {
                  newRuns = [...m.modelRuns]
                  newRuns[existingIdx] = run
                } else {
                  newRuns = [...m.modelRuns, run]
                }

                return { ...m, modelRuns: newRuns }
              }),
            }))
          } else if (event.type === 'done') {
            set({ isSending: false })

            // Fire-and-forget: auto-integrate for multi mode
            if (mode === 'multi' && realUserMessageId) {
              const currentMsg = get().messages.find(m => m.id === realUserMessageId)
              const completedCount = currentMsg?.modelRuns.filter(r => r.status === 'COMPLETED').length ?? 0
              if (completedCount >= 2) {
                get().executeIntegrate(realUserMessageId, roomId)
              }
            }
          } else if (event.type === 'error') {
            console.error('[SSE error event]', event.error)
            set({ isSending: false })
          }
        }
      }

      // Safety: ensure isSending is cleared even if done event was missed
      if (get().isSending) {
        set({ isSending: false })
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
