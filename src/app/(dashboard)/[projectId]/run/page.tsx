'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useEvalStore } from '@/stores/eval-store'
import { EvalProgress } from '@/components/eval/EvalProgress'

export default function RunPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const { evalRuns, activeRunId, progress, isRunning, fetchEvalRuns, runEvaluation } = useEvalStore()
  const startedRef = useRef(false)

  useEffect(() => {
    fetchEvalRuns(projectId)
  }, [projectId])

  // Auto-start evaluation for PENDING runs
  useEffect(() => {
    if (startedRef.current) return
    const pendingRun = evalRuns.find(r => r.status === 'PENDING')
    if (pendingRun) {
      startedRef.current = true
      runEvaluation(projectId, pendingRun.id).catch(err => {
        console.error('Evaluation failed:', err)
      })
    }
  }, [evalRuns])

  // Navigate to report when complete
  useEffect(() => {
    if (progress?.type === 'complete') {
      const timer = setTimeout(() => router.push(`/${projectId}/report`), 1500)
      return () => clearTimeout(timer)
    }
  }, [progress])

  const activeRun = evalRuns.find(r => r.id === activeRunId) || evalRuns[0]

  if (!activeRun) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-muted-foreground">評価ランがありません</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-xl font-bold mb-6">評価実行中</h1>
        <EvalProgress
          run={activeRun}
          progress={progress}
        />
      </div>
    </div>
  )
}
