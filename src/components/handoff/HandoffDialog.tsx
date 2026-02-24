'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import { getModelLabel } from '@/lib/utils'

interface HandoffDialogProps {
  runId: string
  sourceModel: string
  type: 'verify' | 'debate'
  onClose: () => void
  onExecute: (runId: string, targetModel: string, userOverride?: string) => Promise<void>
}

export function HandoffDialog({ runId, sourceModel, type, onClose, onExecute }: HandoffDialogProps) {
  const [targetModel, setTargetModel] = useState(SUPPORTED_MODELS.find(m => m.model !== sourceModel)?.model ?? '')
  const [userOverride, setUserOverride] = useState('')
  const [loading, setLoading] = useState(false)

  const handleExecute = async () => {
    setLoading(true)
    await onExecute(runId, targetModel, userOverride || undefined)
    setLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-[480px] max-w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">
            {type === 'verify' ? '検証' : 'ディベート'}を実行
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">転送先モデル</label>
            <select
              value={targetModel}
              onChange={(e) => setTargetModel(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {SUPPORTED_MODELS.filter(m => m.model !== sourceModel).map(m => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">追加指示（任意）</label>
            <textarea
              value={userOverride}
              onChange={(e) => setUserOverride(e.target.value)}
              placeholder="特定の観点での検証など..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none h-20"
            />
          </div>

          <div className="bg-gray-50 rounded-md p-3 text-xs text-gray-500">
            <div className="font-medium text-gray-700 mb-1">送信内容プレビュー</div>
            {type === 'verify' ? (
              <p>「{getModelLabel(sourceModel)}の回答」を「{getModelLabel(targetModel)}」が検証します</p>
            ) : (
              <p>「{getModelLabel(targetModel)}」が反論 → 「{getModelLabel(sourceModel)}」が再反論（自動停止）</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button variant="outline" onClick={onClose} className="flex-1">キャンセル</Button>
          <Button onClick={handleExecute} disabled={!targetModel || loading} className="flex-1">
            {loading ? '実行中...' : '実行'}
          </Button>
        </div>
      </div>
    </div>
  )
}
