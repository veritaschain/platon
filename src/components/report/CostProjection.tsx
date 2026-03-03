'use client'

import { useState } from 'react'
import type { CostProjectionEntry } from '@/lib/eval/types'

interface CostProjectionProps {
  costProjection: CostProjectionEntry[]
}

export function CostProjection({ costProjection }: CostProjectionProps) {
  const [monthlyRequests, setMonthlyRequests] = useState(1000)

  if (costProjection.length === 0) return null

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">コスト試算</h2>

      <div className="mb-4">
        <label className="text-sm text-muted-foreground block mb-1">
          月間想定利用回数
        </label>
        <input
          type="number"
          value={monthlyRequests}
          onChange={(e) => setMonthlyRequests(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          min={1}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">モデル</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">1,000回コスト</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">月額推定</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">中央値 入力</th>
              <th className="text-right py-2 px-2 font-medium text-muted-foreground">中央値 出力</th>
            </tr>
          </thead>
          <tbody>
            {costProjection
              .sort((a, b) => a.costPer1000 - b.costPer1000)
              .map(entry => {
                const monthlyCost = (entry.costPer1000 / 1000) * monthlyRequests
                return (
                  <tr key={entry.model} className="border-b border-border/50">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{entry.model}</div>
                      <div className="text-[10px] text-muted-foreground">{entry.provider}</div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-xs">
                      ${entry.costPer1000.toFixed(3)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-xs font-semibold">
                      ${monthlyCost.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right text-xs text-muted-foreground">
                      {entry.medianInputTokens}
                    </td>
                    <td className="py-2 px-2 text-right text-xs text-muted-foreground">
                      {entry.medianOutputTokens}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
