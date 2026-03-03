'use client'

import type { EvalProgressEvent } from '@/lib/eval/types'
import { cn } from '@/lib/utils'

interface EvalProgressProps {
  run: {
    id: string
    status: string
    targetModels: string[]
  }
  progress: EvalProgressEvent | null
}

export function EvalProgress({ run, progress }: EvalProgressProps) {
  const completedCount = progress?.completedCount || 0
  const totalCount = progress?.totalCount || 1
  const percent = Math.round((completedCount / totalCount) * 100)

  const isComplete = progress?.type === 'complete'
  const isError = progress?.type === 'error'
  const isScoring = progress?.type === 'scoring_start' || progress?.type === 'scoring_complete' || run.status === 'SCORING'

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <div className="p-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">全体進捗</h3>
          <span className="text-sm text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
        </div>

        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isComplete ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-primary'
            )}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          {percent}% 完了
        </p>
      </div>

      {/* Status */}
      <div className="p-4 rounded-lg border border-border">
        <h3 className="font-medium text-sm mb-3">ステータス</h3>

        <div className="space-y-2">
          <StatusStep
            label="モデル応答を取得中"
            active={run.status === 'RUNNING' && !isScoring}
            complete={isScoring || isComplete}
            error={isError && !isScoring}
          />
          <StatusStep
            label="品質採点中 (LLM-as-a-Judge)"
            active={isScoring && !isComplete}
            complete={isComplete || progress?.type === 'report_generating'}
          />
          <StatusStep
            label="レポート生成中"
            active={progress?.type === 'report_generating'}
            complete={isComplete}
          />
        </div>
      </div>

      {/* Message */}
      {progress?.message && (
        <div className={cn(
          'p-3 rounded-lg text-sm',
          isComplete ? 'bg-green-50 text-green-700 border border-green-200' :
          isError ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-blue-50 text-blue-700 border border-blue-200'
        )}>
          {progress.message}
        </div>
      )}

      {/* Model List */}
      <div className="p-4 rounded-lg border border-border">
        <h3 className="font-medium text-sm mb-2">対象モデル</h3>
        <div className="flex flex-wrap gap-2">
          {run.targetModels.map(model => (
            <span
              key={model}
              className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700"
            >
              {model}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatusStep({ label, active, complete, error }: {
  label: string
  active?: boolean
  complete?: boolean
  error?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
        complete ? 'bg-green-500' :
        error ? 'bg-red-500' :
        active ? 'bg-primary' :
        'bg-gray-200'
      )}>
        {complete && <span className="text-white text-[10px]">✓</span>}
        {active && <span className="block w-2 h-2 bg-white rounded-full animate-pulse" />}
        {error && <span className="text-white text-[10px]">✕</span>}
      </div>
      <span className={cn(
        'text-sm',
        active ? 'text-foreground font-medium' :
        complete ? 'text-green-700' :
        error ? 'text-red-500' :
        'text-muted-foreground'
      )}>
        {label}
      </span>
    </div>
  )
}
