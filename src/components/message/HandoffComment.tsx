'use client'
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { ResponseCard } from './ResponseCard'
import type { ModelRun } from '@/stores/message-store'
import { getModelLabel } from '@/lib/utils'

interface HandoffCommentProps {
  run: ModelRun
  children?: ModelRun[]
}

function getHandoffLabel(templateType: string): { icon: string; verb: string } {
  switch (templateType) {
    case 'VERIFY':
      return { icon: '\uD83D\uDD0D', verb: 'が検証' }
    case 'DEBATE':
      return { icon: '\u2694\uFE0F', verb: 'が反論' }
    default:
      return { icon: '\uD83D\uDD04', verb: 'が再反論' }
  }
}

function getSummaryHint(run: ModelRun): string {
  const content = run.assistantMessage?.content ?? ''
  if (!content) return ''
  // Extract a short hint from the content
  const firstLine = content.split('\n').find(l => l.trim().length > 0) ?? ''
  const cleaned = firstLine.replace(/^[#*\->\s]+/, '').trim()
  return cleaned.length > 40 ? cleaned.slice(0, 40) + '...' : cleaned
}

export function HandoffComment({ run, children }: HandoffCommentProps) {
  const [expanded, setExpanded] = useState(false)

  const templateType = run.handoffInfo?.templateType ?? 'VERIFY'
  const { icon, verb } = getHandoffLabel(templateType)
  const modelLabel = getModelLabel(run.model)
  const hint = getSummaryHint(run)

  return (
    <div className="ml-4 mt-2">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors py-1 px-2 -ml-2 rounded hover:bg-gray-50 w-full text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>
          {icon} {modelLabel}{verb}
        </span>
        {!expanded && hint && (
          <span className="text-xs text-gray-400 truncate">
            {' \u2014 '}{hint}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="ml-4 mt-1 pl-3 border-l-2 border-gray-200">
          <ResponseCard run={run} />

          {/* Nested handoff children (e.g. rebuttal after counter) */}
          {children?.map(child => (
            <HandoffComment key={child.id} run={child} />
          ))}
        </div>
      )}
    </div>
  )
}
