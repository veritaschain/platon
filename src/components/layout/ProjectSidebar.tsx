'use client'

import { useEffect, useState } from 'react'
import { useProjectStore } from '@/stores/project-store'
import { useUsageStore } from '@/stores/usage-store'
import { Button } from '@/components/common/Button'
import { cn, formatCostMulti } from '@/lib/utils'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface ProjectSidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '下書き', color: 'bg-gray-200 text-gray-600' },
  RUNNING: { label: '実行中', color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '完了', color: 'bg-green-100 text-green-700' },
  FAILED: { label: 'エラー', color: 'bg-red-100 text-red-700' },
}

export function ProjectSidebar({ mobileOpen, onMobileClose }: ProjectSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { projects, activeProjectId, isLoading, fetchProjects, createProject, selectProject } = useProjectStore()
  const { daily, monthly, dailyPercent, monthlyPercent, limits, selectedCurrency, exchangeRates, fetchUsage, fetchExchangeRates, cycleCurrency } = useUsageStore()
  const router = useRouter()
  const params = useParams()

  useEffect(() => {
    fetchProjects()
    fetchUsage()
    fetchExchangeRates()
  }, [])

  // Sync activeProjectId from URL
  useEffect(() => {
    if (params.projectId && typeof params.projectId === 'string') {
      selectProject(params.projectId)
    }
  }, [params.projectId])

  const handleCreateProject = async () => {
    const project = await createProject('新規プロジェクト')
    if (project?.id) router.push(`/${project.id}/onboarding`)
    onMobileClose?.()
  }

  const handleSelectProject = (id: string) => {
    selectProject(id)
    const project = projects.find(p => p.id === id)
    if (project?.status === 'COMPLETED') {
      router.push(`/${id}/report`)
    } else if (project?.status === 'RUNNING') {
      router.push(`/${id}/run`)
    } else {
      router.push(`/${id}/onboarding`)
    }
    onMobileClose?.()
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const dailyColor = dailyPercent >= 80 ? 'bg-red-500' : dailyPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  const monthlyColor = monthlyPercent >= 80 ? 'bg-red-500' : monthlyPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  const worstPercent = Math.max(dailyPercent, monthlyPercent)
  const dotColor = worstPercent >= 80 ? 'bg-red-500' : worstPercent >= 60 ? 'bg-yellow-400' : 'bg-green-500'

  const currencySymbols: Record<string, string> = { USD: '$', JPY: '¥', EUR: '€', CNY: '¥', GBP: '£' }

  const sidebarContent = (
    <aside
      className={cn(
        'flex flex-col h-full border-r border-border bg-card transition-all duration-200 flex-shrink-0',
        mobileOpen !== undefined ? 'w-[280px]' : (collapsed ? 'w-14' : 'w-[280px]')
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border min-h-[56px]">
        {(!collapsed || mobileOpen !== undefined) && (
          <span className="font-semibold text-sm truncate">Platon AI Eval</span>
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

      {/* New Project */}
      <div className="p-2">
        <Button
          onClick={handleCreateProject}
          size="sm"
          className={cn('w-full', collapsed && mobileOpen === undefined && 'px-0')}
        >
          {collapsed && mobileOpen === undefined ? '+' : '+ 新規プロジェクト'}
        </Button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : projects.length === 0 && (!collapsed || mobileOpen !== undefined) ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            プロジェクトがありません
          </p>
        ) : (
          projects.map((project) => {
            const badge = STATUS_BADGE[project.status] || STATUS_BADGE.DRAFT
            return (
              <button
                key={project.id}
                onClick={() => handleSelectProject(project.id)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  activeProjectId === project.id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground'
                )}
                title={project.name}
              >
                {collapsed && mobileOpen === undefined ? (
                  <span className={cn('inline-block w-2 h-2 rounded-full', badge.color.split(' ')[0])} />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="block truncate flex-1">{project.name}</span>
                    <span className={cn('text-[9px] px-1 py-0.5 rounded', badge.color)}>
                      {badge.label}
                    </span>
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* Cost Meter */}
      <div className="border-t border-border px-2 py-2">
        {collapsed && mobileOpen === undefined ? (
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
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>今日</span>
                <span>{formatCostMulti(daily, selectedCurrency, exchangeRates)} / {formatCostMulti(limits.DAILY_USD, selectedCurrency, exchangeRates)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', dailyColor)} style={{ width: `${Math.min(dailyPercent, 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                <span>今月</span>
                <span>{formatCostMulti(monthly, selectedCurrency, exchangeRates)} / {formatCostMulti(limits.MONTHLY_USD, selectedCurrency, exchangeRates)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', monthlyColor)} style={{ width: `${Math.min(monthlyPercent, 100)}%` }} />
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

  if (mobileOpen !== undefined) {
    if (!mobileOpen) return null
    return (
      <div className="fixed inset-0 z-50 md:hidden">
        <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
        <div className="relative z-10 h-full w-[280px]">{sidebarContent}</div>
      </div>
    )
  }

  return <div className="hidden md:block">{sidebarContent}</div>
}
