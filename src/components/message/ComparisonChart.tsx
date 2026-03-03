'use client'
import type { ModelRun } from '@/stores/message-store'
import { getModelLabel, getProviderColor, formatCost, formatTokens } from '@/lib/utils'
import { DollarSign, Clock, Zap } from 'lucide-react'

interface ComparisonChartProps {
  runs: ModelRun[]
}

interface BarData {
  model: string
  provider: string
  value: number
  label: string
}

function HorizontalBar({ items, icon, title }: { items: BarData[]; icon: React.ReactNode; title: string }) {
  const maxVal = Math.max(...items.map(i => i.value), 0.001)

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-2 text-xs text-gray-500 font-medium">
        {icon}
        {title}
      </div>
      <div className="space-y-1.5">
        {items.map(item => {
          const percent = (item.value / maxVal) * 100
          return (
            <div key={item.model} className="flex items-center gap-2">
              <span className={`text-[10px] w-20 truncate ${getProviderColor(item.provider)}`}>
                {getModelLabel(item.model)}
              </span>
              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getBarColor(item.provider)}`}
                  style={{ width: `${Math.max(percent, 2)}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 w-16 text-right tabular-nums">
                {item.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getBarColor(provider: string): string {
  switch (provider) {
    case 'OPENAI': return 'bg-green-400'
    case 'ANTHROPIC': return 'bg-orange-400'
    case 'GOOGLE': return 'bg-blue-400'
    case 'XAI': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
}

export function ComparisonChart({ runs }: ComparisonChartProps) {
  const completed = runs.filter(r => r.status === 'COMPLETED')
  if (completed.length < 2) return null

  const costData: BarData[] = completed
    .filter(r => r.estimatedCostUsd != null)
    .map(r => ({
      model: r.model,
      provider: r.provider,
      value: Number(r.estimatedCostUsd),
      label: formatCost(Number(r.estimatedCostUsd)),
    }))
    .sort((a, b) => a.value - b.value)

  const latencyData: BarData[] = completed
    .filter(r => r.latencyMs != null)
    .map(r => ({
      model: r.model,
      provider: r.provider,
      value: r.latencyMs!,
      label: `${(r.latencyMs! / 1000).toFixed(1)}s`,
    }))
    .sort((a, b) => a.value - b.value)

  const tokenData: BarData[] = completed
    .filter(r => r.outputTokens != null)
    .map(r => ({
      model: r.model,
      provider: r.provider,
      value: r.outputTokens!,
      label: formatTokens(r.outputTokens!),
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 mt-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {costData.length >= 2 && (
          <HorizontalBar
            items={costData}
            icon={<DollarSign size={12} />}
            title="コスト"
          />
        )}
        {latencyData.length >= 2 && (
          <HorizontalBar
            items={latencyData}
            icon={<Clock size={12} />}
            title="応答時間"
          />
        )}
        {tokenData.length >= 2 && (
          <HorizontalBar
            items={tokenData}
            icon={<Zap size={12} />}
            title="出力トークン"
          />
        )}
      </div>
    </div>
  )
}
