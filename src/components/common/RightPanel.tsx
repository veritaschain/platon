'use client'
import { useEffect } from 'react'
import { useUsageStore } from '@/stores/usage-store'
import { useHandoffStore, type HandoffResult } from '@/stores/handoff-store'
import { useRoomStore } from '@/stores/room-store'
import { DollarSign, TrendingUp, ArrowRightLeft, CheckCircle, Swords, Sparkles } from 'lucide-react'
import { cn, formatCostMulti } from '@/lib/utils'

const TEMPLATE_LABELS: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  VERIFY: { label: '検証', icon: CheckCircle, color: 'text-blue-600' },
  DEBATE: { label: 'ディベート', icon: Swords, color: 'text-orange-600' },
  INTEGRATE: { label: '統合', icon: Sparkles, color: 'text-purple-600' },
}

export function RightPanel() {
  const { daily, monthly, dailyPercent, monthlyPercent, limits, selectedCurrency, exchangeRates, cycleCurrency, fetchUsage, fetchExchangeRates } = useUsageStore()
  const { handoffs, fetchHandoffs, setActiveHandoff } = useHandoffStore()
  const { activeRoomId } = useRoomStore()

  useEffect(() => {
    fetchUsage()
    fetchExchangeRates()
  }, [])
  useEffect(() => {
    if (activeRoomId) fetchHandoffs(activeRoomId)
  }, [activeRoomId])

  const currencySymbols: Record<string, string> = { USD: '$', JPY: '¥', EUR: '€', CNY: '¥', GBP: '£' }

  return (
    <aside className="w-[320px] border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto hidden xl:block">
      {/* コストダッシュボード */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-gray-700 flex items-center gap-2">
          <DollarSign size={15} />コストダッシュボード
        </h3>
        <button
          onClick={cycleCurrency}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-0.5 rounded border border-gray-200 hover:border-gray-400 transition-colors"
          title="通貨切替"
        >
          {currencySymbols[selectedCurrency]}{selectedCurrency}
        </button>
      </div>

      <div className="space-y-4">
        <CostMeter
          label="今日"
          used={daily}
          limit={limits.DAILY_USD}
          percent={dailyPercent}
          currency={selectedCurrency}
          rates={exchangeRates}
        />
        <CostMeter
          label="今月"
          used={monthly}
          limit={limits.MONTHLY_USD}
          percent={monthlyPercent}
          currency={selectedCurrency}
          rates={exchangeRates}
        />
      </div>

      {/* ハンドオフ履歴 */}
      <div className="mt-6">
        <h3 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
          <ArrowRightLeft size={15} />ハンドオフ履歴
        </h3>
        {handoffs.length === 0 ? (
          <p className="text-xs text-gray-400">まだハンドオフはありません</p>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {handoffs.map((h) => (
              <HandoffItem
                key={h.id}
                handoff={h}
                onClick={() => setActiveHandoff(h)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ガバナンス状態 */}
      <div className="mt-6">
        <h3 className="font-semibold text-sm text-gray-700 mb-2 flex items-center gap-2">
          <TrendingUp size={15} />ガバナンス状態
        </h3>
        <div className="space-y-2 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            PIIマスキング: 常時ON
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            ループ検出: 常時ON
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            イベントログ: 記録中
          </div>
          {dailyPercent >= 80 && (
            <div className="flex items-center gap-2 text-orange-600">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              コスト上限80%に到達 - 軽量モードに切替
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function HandoffItem({ handoff, onClick }: { handoff: HandoffResult; onClick: () => void }) {
  const tmpl = TEMPLATE_LABELS[handoff.templateType] ?? { label: handoff.templateType, icon: ArrowRightLeft, color: 'text-gray-600' }
  const Icon = tmpl.icon
  const sourceModel = handoff.sourceModelRun?.model ?? '?'
  const targetModel = handoff.targetModelRun?.model ?? '...'
  const status = handoff.targetModelRun?.status ?? 'PENDING'
  const time = new Date(handoff.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className={tmpl.color} />
        <span className={cn('text-xs font-medium', tmpl.color)}>{tmpl.label}</span>
        <span className="text-[10px] text-gray-400 ml-auto">{time}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-gray-500">
        <span className="truncate max-w-[100px]">{sourceModel}</span>
        <ArrowRightLeft size={10} className="text-gray-300 shrink-0" />
        <span className="truncate max-w-[100px]">{targetModel}</span>
        <span className={cn(
          'ml-auto text-[10px] font-medium',
          status === 'COMPLETED' ? 'text-green-600' :
          status === 'FAILED' || status === 'TIMEOUT' ? 'text-red-500' : 'text-gray-400'
        )}>
          {status === 'COMPLETED' ? '完了' : status === 'FAILED' ? '失敗' : status === 'TIMEOUT' ? 'タイムアウト' : '実行中'}
        </span>
      </div>
    </button>
  )
}

function CostMeter({ label, used, limit, percent, currency, rates }: {
  label: string
  used: number
  limit: number
  percent: number
  currency: string
  rates: Record<string, number>
}) {
  const color = percent >= 80 ? 'bg-red-500' : percent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span>{formatCostMulti(used, currency, rates)} / {formatCostMulti(limit, currency, rates)}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  )
}
