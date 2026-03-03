import { create } from 'zustand'
import type { EvalProgressEvent } from '@/lib/eval/types'

interface EvalRun {
  id: string
  status: 'PENDING' | 'RUNNING' | 'SCORING' | 'COMPLETED' | 'FAILED'
  targetModels: string[]
  judgeModel: string
  estimatedCostUsd: number | null
  actualCostUsd: number | null
  createdAt: string
  completedAt: string | null
}

interface EvalStore {
  evalRuns: EvalRun[]
  activeRunId: string | null
  progress: EvalProgressEvent | null
  isRunning: boolean
  isLoading: boolean
  fetchEvalRuns: (projectId: string) => Promise<void>
  startEvalRun: (projectId: string, params: {
    targetModels: string[]
    judgeModel: string
  }) => Promise<string>
  subscribeProgress: (projectId: string, runId: string) => () => void
  setProgress: (event: EvalProgressEvent | null) => void
}

export const useEvalStore = create<EvalStore>((set, get) => ({
  evalRuns: [],
  activeRunId: null,
  progress: null,
  isRunning: false,
  isLoading: false,

  fetchEvalRuns: async (projectId: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`/api/projects/${projectId}/eval-runs`)
      const runs = await res.json()
      set({ evalRuns: Array.isArray(runs) ? runs : [], isLoading: false })
    } catch {
      set({ evalRuns: [], isLoading: false })
    }
  },

  startEvalRun: async (projectId: string, params) => {
    set({ isRunning: true, progress: null })
    const res = await fetch(`/api/projects/${projectId}/eval-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      set({ isRunning: false })
      const err = await res.json().catch(() => ({ error: '評価の開始に失敗しました' }))
      throw new Error(err.error)
    }

    const { runId } = await res.json()
    set(s => ({ activeRunId: runId }))
    return runId
  },

  subscribeProgress: (projectId: string, runId: string) => {
    const eventSource = new EventSource(
      `/api/projects/${projectId}/eval-runs/${runId}/progress`
    )

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as EvalProgressEvent
        set({ progress: data })

        if (data.type === 'complete' || data.type === 'error') {
          set({ isRunning: false })
          eventSource.close()
          // Refresh eval runs
          get().fetchEvalRuns(projectId)
        }
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      set({ isRunning: false })
      eventSource.close()
    }

    // Return cleanup function
    return () => {
      eventSource.close()
    }
  },

  setProgress: (event: EvalProgressEvent | null) => set({ progress: event }),
}))
