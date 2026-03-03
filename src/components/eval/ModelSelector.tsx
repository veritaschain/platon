'use client'

import { useState, useEffect } from 'react'
import { useConnectorStore } from '@/stores/connector-store'
import { usePromptSetStore } from '@/stores/prompt-set-store'
import { useEvalStore } from '@/stores/eval-store'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  projectId: string
  onStartEval: (runId: string) => void
}

const JUDGE_MODELS = SUPPORTED_MODELS.filter(m => m.tier === 'lite')

export function ModelSelector({ projectId, onStartEval }: ModelSelectorProps) {
  const { apiKeys, fetchApiKeys } = useConnectorStore()
  const { promptSet } = usePromptSetStore()
  const { startEvalRun } = useEvalStore()
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [judgeModel, setJudgeModel] = useState(JUDGE_MODELS[0]?.model || '')
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchApiKeys()
  }, [])

  const availableProviders = new Set(apiKeys.map(k => k.provider))
  const availableModels = SUPPORTED_MODELS.filter(m =>
    availableProviders.has(m.provider)
  )

  const toggleModel = (model: string) => {
    setSelectedModels(prev => {
      if (prev.includes(model)) return prev.filter(m => m !== model)
      if (prev.length >= 6) return prev
      return [...prev, model]
    })
    // Ensure judge model is not in selected
    if (model === judgeModel) {
      const alt = JUDGE_MODELS.find(m => m.model !== model && !selectedModels.includes(m.model))
      if (alt) setJudgeModel(alt.model)
    }
  }

  const handleStart = async () => {
    if (selectedModels.length === 0) {
      setError('少なくとも1つのモデルを選択してください')
      return
    }
    if (!judgeModel) {
      setError('ジャッジモデルを選択してください')
      return
    }

    setIsStarting(true)
    setError(null)

    try {
      const runId = await startEvalRun(projectId, { targetModels: selectedModels, judgeModel })
      onStartEval(runId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '評価の開始に失敗しました')
      setIsStarting(false)
    }
  }

  const promptCount = promptSet?.promptItems.length || 0

  return (
    <div className="space-y-6">
      {/* Available Models */}
      <div>
        <h3 className="text-sm font-medium mb-3">
          評価対象モデル（最大6つ）
          <span className="text-muted-foreground font-normal ml-2">{selectedModels.length}/6</span>
        </h3>

        {availableModels.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 border border-border rounded-lg">
            APIキーが登録されていません。
            <a href="/settings" className="text-primary underline ml-1">設定</a>
            からAPIキーを追加してください。
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availableModels.map(model => {
              const isSelected = selectedModels.includes(model.model)
              const isJudge = model.model === judgeModel
              return (
                <button
                  key={model.model}
                  onClick={() => toggleModel(model.model)}
                  disabled={isJudge}
                  className={cn(
                    'p-3 rounded-lg border text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : isJudge
                        ? 'border-border bg-gray-50 opacity-50 cursor-not-allowed'
                        : 'border-border hover:border-primary/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{model.label}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded',
                      model.tier === 'pro' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                    )}>
                      {model.tier}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{model.provider}</span>
                  {isJudge && <span className="text-[10px] text-orange-500 block mt-1">ジャッジとして使用中</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Judge Model */}
      <div>
        <h3 className="text-sm font-medium mb-3">ジャッジモデル</h3>
        <p className="text-xs text-muted-foreground mb-2">
          品質採点に使用するモデル（評価対象には含まれません）
        </p>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={judgeModel}
          onChange={(e) => setJudgeModel(e.target.value)}
        >
          {JUDGE_MODELS.filter(m => !selectedModels.includes(m.model) && availableProviders.has(m.provider)).map(m => (
            <option key={m.model} value={m.model}>{m.label} ({m.provider})</option>
          ))}
        </select>
      </div>

      {/* Cost Estimate */}
      {selectedModels.length > 0 && promptCount > 0 && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
          <p className="font-medium text-blue-900">推定コスト</p>
          <p className="text-blue-700 text-xs mt-1">
            {promptCount}問 × {selectedModels.length}モデル = {promptCount * selectedModels.length}リクエスト
            + ジャッジ{promptCount * selectedModels.length}回
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Start Button */}
      <Button
        onClick={handleStart}
        disabled={isStarting || selectedModels.length === 0}
        className="w-full"
        size="lg"
      >
        {isStarting ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            開始中...
          </span>
        ) : (
          '評価を開始'
        )}
      </Button>
    </div>
  )
}
