'use client'

import ReactMarkdown from 'react-markdown'

interface RecommendationCardProps {
  recommendation: string
}

export function RecommendationCard({ recommendation }: RecommendationCardProps) {
  if (!recommendation) return null

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">推奨アクション</h2>

      <div className="prose prose-sm max-w-none text-foreground">
        <ReactMarkdown>{recommendation}</ReactMarkdown>
      </div>
    </div>
  )
}
