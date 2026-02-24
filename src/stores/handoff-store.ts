import { create } from 'zustand'

export interface HandoffResult {
  id: string
  sourceModelRunId: string
  targetModelRunId: string | null
  templateType: string
  composedPrompt?: string
  userOverride?: string | null
  createdAt: string
  sourceModelRun?: {
    model: string
    provider: string
    assistantMessage?: { content: string }
  }
  targetModelRun?: {
    model: string
    provider: string
    status: string
    latencyMs?: number
    estimatedCostUsd?: number
    assistantMessage?: { content: string }
  }
}

interface HandoffStore {
  handoffs: HandoffResult[]
  activeHandoff: HandoffResult | null
  isLoading: boolean
  setActiveHandoff: (handoff: HandoffResult | null) => void
  fetchHandoffs: (roomId: string) => Promise<void>
  executeVerify: (sourceModelRunId: string, targetModel: string, roomId: string, userOverride?: string) => Promise<void>
  executeDebate: (sourceModelRunId: string, opponentModel: string, roomId: string) => Promise<void>
  executeIntegrate: (userMessageId: string, roomId: string) => Promise<{ integrateResultId?: string } | null>
}

export const useHandoffStore = create<HandoffStore>((set, get) => ({
  handoffs: [],
  activeHandoff: null,
  isLoading: false,

  setActiveHandoff: (handoff) => set({ activeHandoff: handoff }),

  fetchHandoffs: async (roomId) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`/api/handoffs/${roomId}`)
      const data = await res.json()
      set({ handoffs: data.handoffs ?? [], isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  executeVerify: async (sourceModelRunId, targetModel, roomId, userOverride) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/handoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceModelRunId, targetModel, roomId, userOverride }),
      })
      if (res.ok) {
        await get().fetchHandoffs(roomId)
      }
    } catch (err) {
      console.error('[executeVerify]', err)
    } finally {
      set({ isLoading: false })
    }
  },

  executeDebate: async (sourceModelRunId, opponentModel, roomId) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/handoffs/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceModelRunId, opponentModel, roomId }),
      })
      if (res.ok) {
        await get().fetchHandoffs(roomId)
      }
    } catch (err) {
      console.error('[executeDebate]', err)
    } finally {
      set({ isLoading: false })
    }
  },

  executeIntegrate: async (userMessageId, roomId) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/handoffs/integrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId, roomId }),
      })
      const data = await res.json()
      if (res.ok) {
        await get().fetchHandoffs(roomId)
        return { integrateResultId: data.integrateResultId }
      }
      return null
    } catch (err) {
      console.error('[executeIntegrate]', err)
      return null
    } finally {
      set({ isLoading: false })
    }
  },
}))
