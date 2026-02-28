'use client'
import { useState, useRef, KeyboardEvent, useCallback } from 'react'
import { Send, Zap, LayoutGrid, ChevronDown, Settings } from 'lucide-react'
import { cn, getModelLabel } from '@/lib/utils'
import { Button } from '@/components/common/Button'
import { useMessageStore } from '@/stores/message-store'
import { useConnectorStore } from '@/stores/connector-store'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import Link from 'next/link'

type Mode = null | 'verify' | 'multi'

interface MessageInputProps {
  roomId: string
}

export function MessageInput({ roomId }: MessageInputProps) {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const { isSending, sendMessage } = useMessageStore()
  const { selectedModels, toggleModel, apiKeys } = useConnectorStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const handleSend = async () => {
    if (!content.trim() || isSending) return
    const c = content.trim()
    setContent('')
    await sendMessage(roomId, c, mode ?? undefined, mode ? undefined : selectedModels)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCompositionStart = useCallback(() => { isComposingRef.current = true }, [])
  const handleCompositionEnd = useCallback(() => { isComposingRef.current = false }, [])

  const hasApiKey = apiKeys.length > 0

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      {/* Mode selector - horizontally scrollable on mobile */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setMode(null)}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
            mode === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          通常
        </button>
        <button
          onClick={() => setMode('verify')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
            mode === 'verify' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          <Zap size={11} />厳密検証
        </button>
        <button
          onClick={() => setMode('multi')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
            mode === 'multi' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          <LayoutGrid size={11} />多角的レビュー
        </button>

        {/* Model chips or auto-select indicator */}
        {mode === null ? (
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 whitespace-nowrap"
            >
              {selectedModels.length > 0
                ? selectedModels.map(m => getModelLabel(m)).join(', ')
                : 'モデル選択'}
              <ChevronDown size={11} className={cn('transition-transform', showModelPicker && 'rotate-180')} />
            </button>
            {showModelPicker && (
              <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-50 min-w-[200px]">
                {SUPPORTED_MODELS.map(m => (
                  <label key={m.model} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(m.model)}
                      onChange={() => toggleModel(m.model)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="flex items-center px-3 py-1 rounded-full text-xs bg-gray-50 text-gray-400 whitespace-nowrap">
            自動選択
          </span>
        )}
      </div>

      {/* Selected model chips (wrapping) */}
      {mode === null && selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedModels.map(m => (
            <span
              key={m}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-gray-100 text-gray-600"
            >
              {getModelLabel(m)}
              <button
                onClick={() => toggleModel(m)}
                className="hover:text-red-500 ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!hasApiKey && (
        <div className="mb-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
          APIキーが未設定です。
          <Link href="/settings" className="underline font-medium hover:text-amber-800 ml-1">
            設定画面でAPIキーを登録 →
          </Link>
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={mode === 'verify' ? '質問を入力（主AIが回答→別AIが検証）' : mode === 'multi' ? '質問を入力（複数AIで議論→統合）' : 'メッセージを入力... (Shift+Enterで改行)'}
          className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 min-h-[44px] max-h-[200px]"
          rows={1}
          disabled={isSending}
        />
        <Button
          onClick={handleSend}
          disabled={!content.trim() || isSending || !hasApiKey}
          size="md"
          className="shrink-0"
        >
          {isSending ? (
            <span className="animate-spin">⟳</span>
          ) : (
            <Send size={16} />
          )}
        </Button>
      </div>

      {/* API key settings link (always visible) */}
      <div className="mt-1.5 flex justify-end">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Settings size={10} />
          APIキー設定
        </Link>
      </div>
    </div>
  )
}
