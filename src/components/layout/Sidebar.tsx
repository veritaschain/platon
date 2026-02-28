'use client'

import { useEffect, useState } from 'react'
import { useRoomStore } from '@/stores/room-store'
import { useUsageStore } from '@/stores/usage-store'
import { Button } from '@/components/common/Button'
import { cn, formatCostMulti } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { rooms, activeRoomId, isLoading, fetchRooms, createRoom, selectRoom } = useRoomStore()
  const { daily, monthly, dailyPercent, monthlyPercent, limits, selectedCurrency, exchangeRates, fetchUsage, fetchExchangeRates, cycleCurrency } = useUsageStore()
  const router = useRouter()

  useEffect(() => {
    fetchRooms()
    fetchUsage()
    fetchExchangeRates()
  }, [])

  const handleCreateRoom = async () => {
    const room = await createRoom()
    if (room?.id) router.push('/')
    onMobileClose?.()
  }

  const handleSelectRoom = (id: string) => {
    selectRoom(id)
    router.push('/')
    onMobileClose?.()
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const dailyColor = dailyPercent >= 80 ? 'bg-red-500' : dailyPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  const monthlyColor = monthlyPercent >= 80 ? 'bg-red-500' : monthlyPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  // Dot color for collapsed mode: worst of daily/monthly
  const worstPercent = Math.max(dailyPercent, monthlyPercent)
  const dotColor = worstPercent >= 80 ? 'bg-red-500' : worstPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'

  const currencySymbols: Record<string, string> = { USD: '$', JPY: '¥', EUR: '€', CNY: '¥', GBP: '£' }

  const sidebarContent = (
    <aside
      className={cn(
        'flex flex-col h-full border-r border-border bg-card transition-all duration-200 flex-shrink-0',
        // Mobile: always full width when open
        mobileOpen !== undefined ? 'w-[280px]' : (collapsed ? 'w-14' : 'w-[280px]')
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border min-h-[56px]">
        {(!collapsed || mobileOpen !== undefined) && (
          <span className="font-semibold text-sm truncate">Platon AI</span>
        )}
        {mobileOpen !== undefined ? (
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors ml-auto flex-shrink-0"
            title="Close"
          >
            ✕
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors ml-auto flex-shrink-0 hidden md:block"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '→' : '←'}
          </button>
        )}
      </div>

      {/* New Chat */}
      <div className="p-2">
        <Button
          onClick={handleCreateRoom}
          size="sm"
          className={cn('w-full', collapsed && mobileOpen === undefined && 'px-0')}
        >
          {collapsed && mobileOpen === undefined ? '+' : '+ New Chat'}
        </Button>
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : rooms.length === 0 && (!collapsed || mobileOpen !== undefined) ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            まだチャットがありません
          </p>
        ) : (
          rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => handleSelectRoom(room.id)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                activeRoomId === room.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground'
              )}
              title={room.title}
            >
              {collapsed && mobileOpen === undefined ? '💬' : <span className="block truncate">{room.title}</span>}
            </button>
          ))
        )}
      </div>

      {/* Cost Meter */}
      <div className="border-t border-border px-2 py-2">
        {collapsed && mobileOpen === undefined ? (
          // Collapsed: colored dot
          <div className="flex justify-center">
            <button
              onClick={cycleCurrency}
              className="group relative"
              title={`日次: ${dailyPercent.toFixed(0)}% / 月次: ${monthlyPercent.toFixed(0)}%`}
            >
              <span className={cn('block w-3 h-3 rounded-full', dotColor)} />
            </button>
          </div>
        ) : (
          // Expanded: mini progress bars
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-medium">コスト</span>
              <button
                onClick={cycleCurrency}
                className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded transition-colors"
                title="通貨切替"
              >
                {currencySymbols[selectedCurrency]}{selectedCurrency}
              </button>
            </div>
            {/* Daily */}
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>今日</span>
                <span>{formatCostMulti(daily, selectedCurrency, exchangeRates)} / {formatCostMulti(limits.DAILY_USD, selectedCurrency, exchangeRates)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', dailyColor)}
                  style={{ width: `${Math.min(dailyPercent, 100)}%` }}
                />
              </div>
            </div>
            {/* Monthly */}
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>今月</span>
                <span>{formatCostMulti(monthly, selectedCurrency, exchangeRates)} / {formatCostMulti(limits.MONTHLY_USD, selectedCurrency, exchangeRates)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', monthlyColor)}
                  style={{ width: `${Math.min(monthlyPercent, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={() => { router.push('/settings'); onMobileClose?.() }}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {collapsed && mobileOpen === undefined ? '⚙' : '⚙ Settings'}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {collapsed && mobileOpen === undefined ? '↩' : '↩ Logout'}
        </button>
      </div>
    </aside>
  )

  // Mobile overlay mode
  if (mobileOpen !== undefined) {
    if (!mobileOpen) return null
    return (
      <div className="fixed inset-0 z-50 md:hidden">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={onMobileClose}
        />
        {/* Sidebar */}
        <div className="relative z-10 h-full w-[280px]">
          {sidebarContent}
        </div>
      </div>
    )
  }

  // Desktop mode
  return <div className="hidden md:block">{sidebarContent}</div>
}
