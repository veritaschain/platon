'use client'

import { cn } from '@/lib/utils'

interface QuestionCardProps {
  question: string
  type: 'single' | 'multi' | 'text' | 'mixed'
  options?: string[]
  value?: string | string[]
  onChange: (value: string | string[]) => void
}

export function QuestionCard({ question, type, options, value, onChange }: QuestionCardProps) {
  const handleChipClick = (option: string) => {
    if (type === 'multi') {
      const current = Array.isArray(value) ? value : []
      if (current.includes(option)) {
        onChange(current.filter(v => v !== option))
      } else {
        onChange([...current, option])
      }
    } else {
      onChange(option)
    }
  }

  const isSelected = (option: string) => {
    if (type === 'multi' && Array.isArray(value)) {
      return value.includes(option)
    }
    return value === option
  }

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h2 className="text-lg font-semibold mb-4">{question}</h2>

      {type === 'text' ? (
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-none"
          placeholder="自由に記述してください..."
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="space-y-4">
          {/* Option chips */}
          {options && (
            <div className="flex flex-wrap gap-2">
              {options.map(option => (
                <button
                  key={option}
                  onClick={() => handleChipClick(option)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm border transition-all',
                    isSelected(option)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:border-primary/50'
                  )}
                >
                  {type === 'multi' && isSelected(option) && '✓ '}
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Text input for "mixed" type or "その他" */}
          {(type === 'mixed' || (options?.includes('その他') && value === 'その他')) && (
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="その他の場合はここに入力..."
              value={typeof value === 'string' && !options?.includes(value) ? value : ''}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  )
}
