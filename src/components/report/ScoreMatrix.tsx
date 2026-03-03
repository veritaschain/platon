'use client'

import type { ScoreMatrixEntry } from '@/lib/eval/types'
import { cn } from '@/lib/utils'

interface ScoreMatrixProps {
  scoreMatrix: ScoreMatrixEntry[]
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: '正確性',
  relevance: '関連性',
  conciseness: '簡潔性',
  tone: 'トーン',
  instructionFollowing: '指示遵守',
  latency: 'レイテンシ',
  cost: 'コスト効率',
  errorRate: 'エラー率',
  formatCompliance: 'フォーマット',
  quality: '品質総合',
}

function getScoreColor(score: number): string {
  if (score >= 7.0) return 'bg-green-100 text-green-800'
  if (score >= 4.0) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

export function ScoreMatrix({ scoreMatrix }: ScoreMatrixProps) {
  if (scoreMatrix.length === 0) return null

  const metrics = Object.keys(scoreMatrix[0].metrics)

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">スコア比較テーブル</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">指標</th>
              {scoreMatrix.map(entry => (
                <th key={entry.model} className="text-center py-2 px-2 font-medium min-w-[80px]">
                  <div className="text-xs">{entry.model}</div>
                  <div className="text-[10px] text-muted-foreground">{entry.provider}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(metric => (
              <tr key={metric} className="border-b border-border/50">
                <td className="py-2 pr-4 text-muted-foreground text-xs">
                  {METRIC_LABELS[metric] || metric}
                </td>
                {scoreMatrix.map(entry => {
                  const score = entry.metrics[metric]
                  return (
                    <td key={entry.model} className="py-2 px-2 text-center">
                      <span className={cn(
                        'inline-block px-2 py-0.5 rounded text-xs font-medium',
                        getScoreColor(score)
                      )}>
                        {score.toFixed(1)}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 mt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded bg-green-500" /> ≥7.0
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded bg-yellow-400" /> 4.0-6.9
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded bg-red-400" /> &lt;4.0
        </span>
      </div>
    </div>
  )
}
