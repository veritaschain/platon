'use client'
import { useState, useRef, KeyboardEvent, useCallback, DragEvent, ClipboardEvent } from 'react'
import { Send, Zap, LayoutGrid, ChevronDown, Settings, Paperclip, X } from 'lucide-react'
import { cn, getModelLabel } from '@/lib/utils'
import { Button } from '@/components/common/Button'
import { useMessageStore } from '@/stores/message-store'
import { useConnectorStore } from '@/stores/connector-store'
import { SUPPORTED_MODELS, IMAGE_CONSTRAINTS } from '@/lib/connectors/types'
import Link from 'next/link'

type Mode = null | 'verify' | 'multi'

interface AttachedImage {
  base64: string
  mimeType: string
  previewUrl: string
  fileName: string
}

interface MessageInputProps {
  roomId: string
}

const ALLOWED_TYPES = IMAGE_CONSTRAINTS.allowedMimeTypes as readonly string[]
const MAX_SIZE = IMAGE_CONSTRAINTS.maxSizeBytes

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix to get pure base64
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function MessageInput({ roomId }: MessageInputProps) {
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<Mode>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const { isSending, sendMessage } = useMessageStore()
  const { selectedModels, toggleModel, apiKeys } = useConnectorStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)

  const validateAndAttach = async (file: File) => {
    setImageError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setImageError('JPEG, PNG, GIF, WebPのみ対応しています')
      return
    }

    if (file.size > MAX_SIZE) {
      const maxMB = MAX_SIZE / (1024 * 1024)
      setImageError(`画像サイズが${maxMB}MBを超えています`)
      return
    }

    try {
      const base64 = await readFileAsBase64(file)
      setAttachedImage({
        base64,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file),
        fileName: file.name,
      })
    } catch {
      setImageError('画像の読み込みに失敗しました')
    }
  }

  const removeImage = () => {
    if (attachedImage?.previewUrl) {
      URL.revokeObjectURL(attachedImage.previewUrl)
    }
    setAttachedImage(null)
    setImageError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) validateAndAttach(file)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      validateAndAttach(file)
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) validateAndAttach(file)
        return
      }
    }
  }

  const handleSend = async () => {
    const hasContent = content.trim().length > 0
    const hasImage = !!attachedImage
    if ((!hasContent && !hasImage) || isSending) return

    const c = content.trim()
    const images = attachedImage ? [{ base64: attachedImage.base64, mimeType: attachedImage.mimeType }] : undefined
    setContent('')
    removeImage()
    await sendMessage(roomId, c, mode ?? undefined, mode ? undefined : selectedModels, images)
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
  const canSend = (content.trim().length > 0 || !!attachedImage) && !isSending && hasApiKey

  return (
    <div
      className={cn(
        'border-t border-gray-200 bg-white p-4 transition-colors',
        isDragging && 'bg-blue-50 border-blue-300'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
              ref={pickerBtnRef}
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 whitespace-nowrap"
            >
              {selectedModels.length > 0
                ? selectedModels.map(m => getModelLabel(m)).join(', ')
                : 'モデル選択'}
              <ChevronDown size={11} className={cn('transition-transform', showModelPicker && 'rotate-180')} />
            </button>
            {showModelPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                <div
                  className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[220px]"
                  style={{
                    bottom: `${window.innerHeight - (pickerBtnRef.current?.getBoundingClientRect().top ?? 0) + 4}px`,
                    left: `${pickerBtnRef.current?.getBoundingClientRect().left ?? 0}px`,
                  }}
                >
                  {SUPPORTED_MODELS.map(m => (
                    <label key={m.model} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selectedModels.includes(m.model)}
                        onChange={() => toggleModel(m.model)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </>
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

      {/* Image preview */}
      {attachedImage && (
        <div className="mb-2 inline-flex items-start gap-1 p-1 bg-gray-100 rounded-lg">
          <img
            src={attachedImage.previewUrl}
            alt={attachedImage.fileName}
            className="w-16 h-16 object-cover rounded"
          />
          <button
            onClick={removeImage}
            className="p-0.5 hover:bg-gray-200 rounded-full text-gray-500 hover:text-red-500 transition-colors"
            title="画像を削除"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Image error */}
      {imageError && (
        <div className="mb-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">
          {imageError}
        </div>
      )}

      {/* Drag overlay hint */}
      {isDragging && (
        <div className="mb-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-md text-center">
          画像をドロップして添付
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Input area */}
      <div className="flex gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || !!attachedImage}
          className={cn(
            'shrink-0 p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors self-end',
            (isSending || !!attachedImage) && 'opacity-40 cursor-not-allowed'
          )}
          title="画像を添付 (JPEG, PNG, GIF, WebP / 3MBまで)"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          placeholder={mode === 'verify' ? '質問を入力（主AIが回答→別AIが検証）' : mode === 'multi' ? '質問を入力（複数AIで議論→統合）' : 'メッセージを入力... (Shift+Enterで改行)'}
          className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 min-h-[44px] max-h-[200px]"
          rows={1}
          disabled={isSending}
        />
        <Button
          onClick={handleSend}
          disabled={!canSend}
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
