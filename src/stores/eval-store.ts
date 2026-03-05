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
  runEvaluation: (projectId: string, runId: string) => Promise<void>
  setProgress: (event: EvalProgressEvent | null) => void
}

const BATCH_SIZE = 5

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
    set({ activeRunId: runId })
    return runId
  },

  // Client-side orchestration: calls /step endpoint sequentially
  runEvaluation: async (projectId: string, runId: string) => {
    const stepUrl = `/api/projects/${projectId}/eval-runs/${runId}/step`

    const callStep = async (body: object) => {
      const res = await fetch(stepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'ステップ実行に失敗しました' }))
        throw new Error(err.error)
      }
      return res.json()
    }

    try {
      // Step 1: Init — get prompt items and target models
      set({ progress: { type: 'response_complete', message: '初期化中...', completedCount: 0, totalCount: 1 } })
      const initData = await callStep({ step: 'init' })
      const { promptItems, targetModels } = initData as {
        promptItems: { id: string; prompt: string }[]
        targetModels: string[]
      }

      const totalCount = promptItems.length * targetModels.length
      let completedCount = 0

      // Step 2: Execute — batch by model, then by prompt batch
      for (const model of targetModels) {
        const promptIds = promptItems.map(p => p.id)

        for (let offset = 0; offset < promptIds.length; offset += BATCH_SIZE) {
          const batchIds = promptIds.slice(offset, offset + BATCH_SIZE)

          set({
            progress: {
              type: 'response_complete',
              message: `${model} 実行中... (${completedCount}/${totalCount})`,
              completedCount,
              totalCount,
              totalModels: targetModels.length,
              totalPrompts: promptItems.length,
            },
          })

          const result = await callStep({
            step: 'execute',
            model,
            promptItemIds: batchIds,
          })

          completedCount += (result as { completed: number }).completed
        }
      }

      // Step 3: Judge in batches
      let remaining = totalCount
      while (remaining > 0) {
        set({
          progress: {
            type: 'scoring_start',
            message: `品質採点中... (残り${remaining}件)`,
            completedCount: totalCount,
            totalCount,
          },
        })

        const judgeResult = await callStep({ step: 'judge', limit: 5 }) as { judged: number; remaining: number }
        remaining = judgeResult.remaining
        if (judgeResult.judged === 0) break // No more to judge
      }

      set({
        progress: {
          type: 'report_generating',
          message: 'レポート生成中...',
          completedCount: totalCount,
          totalCount,
        },
      })

      // Step 4: Report
      await callStep({ step: 'report' })

      set({
        isRunning: false,
        progress: {
          type: 'complete',
          message: '評価が完了しました',
          completedCount: totalCount,
          totalCount,
        },
      })

      // Refresh runs list
      get().fetchEvalRuns(projectId)

    } catch (error) {
      set({
        isRunning: false,
        progress: {
          type: 'error',
          message: error instanceof Error ? error.message : '評価中にエラーが発生しました',
        },
      })
      throw error
    }
  },

  setProgress: (event: EvalProgressEvent | null) => set({ progress: event }),
}))
