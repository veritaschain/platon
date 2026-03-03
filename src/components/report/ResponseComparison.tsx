'use client'

import type { HighlightEntry } from '@/lib/eval/types'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

interface ResponseComparisonProps {
  highlights: HighlightEntry[]
}

const CATEGORY_LABELS: Record<string, string> = {
  ACCURACY: '正確性',
  RELEVANCE: '関連性',
  CONCISENESS: '簡潔性',
  TONE: 'トーン',
  INSTRUCTION: '指示遵守',
  EDGE_CASE: 'エッジケース',
  GENERAL: '一般',
}

export function ResponseComparison({ highlights }: ResponseComparisonProps) {
  if (highlights.length === 0) return null

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">注目すべき回答例</h2>
      <p className="text-xs text-muted-foreground mb-4">
        モデル間でスコア差が最も大きかった質問
      </p>

      <div className="space-y-6">
        {highlights.map((h, idx) => (
          <div key={idx} className="border border-border rounded-lg overflow-hidden">
            {/* Question header */}
            <div className="p-3 bg-gray-50 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                  {CATEGORY_LABELS[h.category] || h.category}
                </span>
              </div>
              <p className="text-sm font-medium">{h.prompt}</p>
            </div>

            {/* Responses */}
            <div className="divide-y divide-border">
              {h.responses.map((resp, ri) => (
                <div key={ri} className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">{resp.model}</span>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded font-medium',
                      resp.totalScore >= 3.5 ? 'bg-green-100 text-green-700' :
                      resp.totalScore >= 2.5 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    )}>
                      {resp.totalScore.toFixed(1)}/5
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground prose prose-xs max-w-none">
                    <ReactMarkdown>
                      {resp.content.length > 300 ? resp.content.slice(0, 300) + '...' : resp.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
