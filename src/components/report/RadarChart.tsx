'use client'

import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { RankingEntry } from '@/lib/eval/types'

interface RadarChartProps {
  rankings: RankingEntry[]
}

const AXIS_LABELS: Record<string, string> = {
  accuracy: '正確性',
  relevance: '関連性',
  conciseness: '簡潔性',
  tone: 'トーン',
  instructionFollowing: '指示遵守',
  latency: 'レイテンシ',
  cost: 'コスト効率',
}

const MODEL_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
]

export function RadarChart({ rankings }: RadarChartProps) {
  if (rankings.length === 0) return null

  const axes = Object.keys(AXIS_LABELS)
  const data = axes.map(axis => {
    const point: Record<string, string | number> = { axis: AXIS_LABELS[axis] }
    rankings.forEach(r => {
      const scores = r.normalizedScores
      const value = (scores as any)[axis] ?? 0
      point[r.model] = Math.round(value * 10) / 10
    })
    return point
  })

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-bold mb-4">軸別詳細分析</h2>

      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsRadarChart data={data}>
            <PolarGrid />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fontSize: 11, fill: '#6b7280' }}
            />
            <PolarRadiusAxis
              domain={[0, 10]}
              tick={{ fontSize: 10 }}
              tickCount={6}
            />
            {rankings.map((r, i) => (
              <Radar
                key={r.model}
                name={r.model}
                dataKey={r.model}
                stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
                fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                fillOpacity={0.1}
                strokeWidth={2}
              />
            ))}
            <Legend
              wrapperStyle={{ fontSize: 12 }}
            />
          </RechartsRadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
