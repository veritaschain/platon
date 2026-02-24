'use client'
import { useState, useRef, KeyboardEvent } from 'react'
import { Send, Zap, LayoutGrid, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/common/Button'
import { useMessageStore } from '@/stores/message-store'
import { useConnectorStore } from '@/stores/connector-store'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'

type Mode = null | 'verify' | 'multi'

interface MessageInputProps {
  roomId: string
}

export function MessageInput({ roomId }: MessageInputProps) {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const { isSending, sendMessage } = useMessageStore()
  const { selectedModels, toggleModel, advancedMode, apiKeys } = useConnectorStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    if (!content.trim() || isSending) return
    const c = content.trim()
    setContent('')
    await sendMessage(roomId, c, mode ?? undefined, mode ? undefined : selectedModels)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasApiKey = apiKeys.length > 0

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      {/* Mode selector */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setMode(null)}
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium transition-colors',
            mode === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          通常
        </button>
        <button
          onClick={() => setMode('verify')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
            mode === 'verify' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          <Zap size={11} />厳密検証
        </button>
        <button
          onClick={() => setMode('multi')}
          className={cn(
            'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors',
            mode === 'multi' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          )}
        >
          <LayoutGrid size={11} />多角的レビュー
        </button>

        {advancedMode && mode === null && (
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              モデル選択 ({selectedModels.length}) <ChevronDown size={11} />
            </button>
            {showModelPicker && (
              <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-10 min-w-[200px]">
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
        )}
      </div>

      {!hasApiKey && (
        <div className="mb-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
          APIキーが未設定です。設定画面でAPIキーを登録してください。
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
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
    </div>
  )
}
