'use client'

import { cn } from '@/lib/utils'

export type ChatMode = null | 'verify' | 'multi'

interface ModeSelectorProps {
  mode: ChatMode
  onChange: (mode: ChatMode) => void
  disabled?: boolean
}

const MODES: { id: ChatMode; label: string; description: string; icon: string }[] = [
  {
    id: null,
    label: '通常',
    description: '選択したモデルに送信',
    icon: '💬',
  },
  {
    id: 'verify',
    label: '厳密検証',
    description: '主回答 → 別AIが検証',
    icon: '🔍',
  },
  {
    id: 'multi',
    label: '多角的レビュー',
    description: '3モデル並列 → 統合',
    icon: '🔀',
  },
]

export function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      {MODES.map((m) => (
        <button
          key={m.id ?? 'normal'}
          onClick={() => !disabled && onChange(m.id)}
          disabled={disabled}
          title={m.description}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            mode === m.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span>{m.icon}</span>
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}
