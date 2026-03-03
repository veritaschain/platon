'use client'

import type { RankingEntry } from '@/lib/eval/types'
import { cn } from '@/lib/utils'

interface RankingCardProps {
  rankings: RankingEntry[]
}

export function RankingCard({ rankings }: RankingCardProps) {
  if (rankings.length === 0) return null

  const best = rankings[0]

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">推奨モデルと総合ランキング</h2>

      {/* Top recommendation */}
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 mb-6">
        <p className="text-sm text-muted-foreground mb-1">推奨モデル</p>
        <p className="text-xl font-bold">{best.model}</p>
        <p className="text-sm text-muted-foreground mt-1">
          総合スコア: <span className="font-semibold text-foreground">{best.totalScore}/10</span>
        </p>
      </div>

      {/* Ranking list */}
      <div className="space-y-3">
        {rankings.map((entry) => (
          <div key={entry.model} className="flex items-center gap-3">
            <span className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
              entry.rank === 1 ? 'bg-yellow-100 text-yellow-700' :
              entry.rank === 2 ? 'bg-gray-100 text-gray-600' :
              entry.rank === 3 ? 'bg-orange-100 text-orange-600' :
              'bg-gray-50 text-gray-500'
            )}>
              {entry.rank}
            </span>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium truncate">{entry.model}</span>
                <span className="text-sm font-semibold ml-2">{entry.totalScore}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    entry.totalScore >= 7 ? 'bg-green-500' :
                    entry.totalScore >= 4 ? 'bg-yellow-400' :
                    'bg-red-400'
                  )}
                  style={{ width: `${(entry.totalScore / 10) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
