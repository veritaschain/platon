'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, CheckCircle, Shield, Clock, Zap, Brain } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import type { ModelRun } from '@/stores/message-store'
import { cn, formatCost, formatTokens, getModelLabel, getProviderBg, getProviderColor } from '@/lib/utils'
import { Button } from '@/components/common/Button'

interface ResponseCardProps {
  run: ModelRun
  showHandoffButtons?: boolean
  onVerify?: (runId: string) => void
  onDebate?: (runId: string) => void
}

const TIMEOUT_MS = 30_000

function ThinkingIndicator({ provider, model }: { provider: string; model: string }) {
  const [elapsed, setElapsed] = useState(0)
  const [dotCount, setDotCount] = useState(1)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startRef.current)
      setDotCount(d => (d % 3) + 1)
    }, 100)
    return () => clearInterval(timer)
  }, [])

  const elapsedSec = elapsed / 1000
  const percent = Math.min((elapsed / TIMEOUT_MS) * 100, 100)
  const barColor = percent >= 80 ? 'bg-red-500' : percent >= 60 ? 'bg-yellow-400' : 'bg-green-500'
  const dots = '.'.repeat(dotCount)

  return (
    <div className={cn('rounded-lg border p-4', getProviderBg(provider))}>
      {/* Header with brain icon, model name, thinking text, elapsed */}
      <div className="flex items-center gap-2 mb-3">
        <Brain size={16} className={cn(getProviderColor(provider), 'animate-pulse')} />
        <span className={cn('font-medium text-sm', getProviderColor(provider))}>
          {getModelLabel(model)}
        </span>
        <span className="text-xs text-gray-500">
          思考中{dots}
        </span>
        <span className="text-xs text-gray-400 ml-auto tabular-nums">
          {elapsedSec.toFixed(1)}s
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
        <div
          className={cn('h-full rounded-full transition-all duration-100', barColor)}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Skeleton lines */}
      <div className="space-y-2">
        <div className="h-3 bg-gray-200 rounded animate-pulse w-full" />
        <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
        <div className="h-3 bg-gray-200 rounded animate-pulse w-5/6" />
      </div>
    </div>
  )
}

export function ResponseCard({ run, showHandoffButtons, onVerify, onDebate }: ResponseCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(run.assistantMessage?.content ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (run.status === 'RUNNING' || run.status === 'PENDING') {
    return <ThinkingIndicator provider={run.provider} model={run.model} />
  }

  if (run.status === 'FAILED' || run.status === 'TIMEOUT') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-red-600">{getModelLabel(run.model) || 'エラー'}</span>
          <span className="text-xs text-red-500">
            {run.status === 'TIMEOUT' ? 'タイムアウト' : '失敗'}
          </span>
        </div>
        {run.assistantMessage?.content && (
          <p className="text-xs text-red-600 mt-2">{run.assistantMessage.content}</p>
        )}
        <pre className="text-[10px] text-red-400 mt-2 whitespace-pre-wrap break-all bg-red-100 rounded p-2 max-h-40 overflow-auto">
          {JSON.stringify(run, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border p-4', getProviderBg(run.provider))}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn('font-medium text-sm', getProviderColor(run.provider))}>
            {getModelLabel(run.model)}
          </span>
          {run.latencyMs && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={10} />{(run.latencyMs / 1000).toFixed(1)}s
            </span>
          )}
          {run.piiMasked && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Shield size={10} />PII保護済
            </span>
          )}
        </div>
        <button onClick={handleCopy} className="p-1 hover:bg-white rounded text-gray-400">
          {copied ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
        </button>
      </div>

      {/* Content */}
      <div className="prose prose-sm max-w-none text-gray-800 overflow-x-auto break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {run.assistantMessage?.content ?? ''}
        </ReactMarkdown>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-200">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {run.inputTokens !== undefined && (
            <span className="flex items-center gap-1">
              <Zap size={10} />
              IN: {formatTokens(run.inputTokens)} / OUT: {formatTokens(run.outputTokens ?? 0)}
            </span>
          )}
          {run.estimatedCostUsd !== undefined && (
            <span>{formatCost(Number(run.estimatedCostUsd))}</span>
          )}
        </div>

        {showHandoffButtons && (
          <div className="flex gap-1">
            {onVerify && (
              <Button size="sm" variant="outline" onClick={() => onVerify(run.id)}>
                検証
              </Button>
            )}
            {onDebate && (
              <Button size="sm" variant="outline" onClick={() => onDebate(run.id)}>
                ディベート
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
