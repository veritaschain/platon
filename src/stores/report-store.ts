import { create } from 'zustand'
import type { EvalReportData } from '@/lib/eval/types'

interface ReportStore {
  report: EvalReportData | null
  isLoading: boolean
  fetchReport: (projectId: string, runId: string) => Promise<void>
  exportReport: (projectId: string, runId: string, format: 'pdf' | 'md') => Promise<void>
  clearReport: () => void
}

export const useReportStore = create<ReportStore>((set) => ({
  report: null,
  isLoading: false,

  fetchReport: async (projectId: string, runId: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch(
        `/api/projects/${projectId}/eval-runs/${runId}/report`
      )
      if (res.ok) {
        const data = await res.json()
        set({ report: data, isLoading: false })
      } else {
        set({ report: null, isLoading: false })
      }
    } catch {
      set({ report: null, isLoading: false })
    }
  },

  exportReport: async (projectId: string, runId: string, format: 'pdf' | 'md') => {
    const res = await fetch(
      `/api/projects/${projectId}/eval-runs/${runId}/report/export?format=${format}`
    )
    if (!res.ok) throw new Error('エクスポートに失敗しました')

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eval-report.${format === 'pdf' ? 'pdf' : 'md'}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  clearReport: () => set({ report: null }),
}))
