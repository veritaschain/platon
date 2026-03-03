'use client'

import { useState } from 'react'
import { usePromptSetStore } from '@/stores/prompt-set-store'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'

const CATEGORY_COLORS: Record<string, string> = {
  ACCURACY: 'bg-blue-100 text-blue-700',
  RELEVANCE: 'bg-purple-100 text-purple-700',
  CONCISENESS: 'bg-green-100 text-green-700',
  TONE: 'bg-yellow-100 text-yellow-700',
  INSTRUCTION: 'bg-orange-100 text-orange-700',
  EDGE_CASE: 'bg-red-100 text-red-700',
  GENERAL: 'bg-gray-100 text-gray-700',
}

const CATEGORY_LABELS: Record<string, string> = {
  ACCURACY: '正確性',
  RELEVANCE: '関連性',
  CONCISENESS: '簡潔性',
  TONE: 'トーン',
  INSTRUCTION: '指示遵守',
  EDGE_CASE: 'エッジケース',
  GENERAL: '一般',
}

interface PromptSetEditorProps {
  projectId: string
}

export function PromptSetEditor({ projectId }: PromptSetEditorProps) {
  const { promptSet, editItem, addItem, deleteItem } = usePromptSetStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newPrompt, setNewPrompt] = useState('')
  const [newCategory, setNewCategory] = useState('GENERAL')

  if (!promptSet) return null

  // Group by category
  const grouped = promptSet.promptItems.reduce<Record<string, typeof promptSet.promptItems>>((acc, item) => {
    const cat = item.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  const handleEdit = (itemId: string, currentPrompt: string) => {
    setEditingId(itemId)
    setEditText(currentPrompt)
  }

  const handleSaveEdit = async (itemId: string) => {
    if (editText.trim()) {
      await editItem(projectId, itemId, { prompt: editText.trim() })
    }
    setEditingId(null)
  }

  const handleAdd = async () => {
    if (newPrompt.trim()) {
      await addItem(projectId, {
        category: newCategory,
        prompt: newPrompt.trim(),
        evaluationFocus: '',
        goldStandardHint: null,
        orderIndex: promptSet.promptItems.length,
      })
      setNewPrompt('')
      setShowAdd(false)
    }
  }

  const handleDelete = async (itemId: string) => {
    await deleteItem(projectId, itemId)
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <div className="flex items-center gap-2 mb-3">
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', CATEGORY_COLORS[category] || CATEGORY_COLORS.GENERAL)}>
              {CATEGORY_LABELS[category] || category}
            </span>
            <span className="text-xs text-muted-foreground">{items.length}問</span>
          </div>

          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="group flex items-start gap-2 p-3 rounded-lg border border-border hover:border-primary/30 transition-colors"
              >
                <span className="text-xs text-muted-foreground mt-0.5 w-6 flex-shrink-0">
                  {item.orderIndex + 1}.
                </span>

                {editingId === item.id ? (
                  <div className="flex-1 space-y-2">
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] resize-none"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => handleSaveEdit(item.id)}>保存</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>キャンセル</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1">
                    <p className="text-sm whitespace-pre-wrap">{item.prompt}</p>
                    {item.evaluationFocus && (
                      <p className="text-xs text-muted-foreground mt-1">
                        評価ポイント: {item.evaluationFocus}
                      </p>
                    )}
                  </div>
                )}

                {editingId !== item.id && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => handleEdit(item.id, item.prompt)}
                      className="p-1 rounded hover:bg-accent text-xs text-muted-foreground"
                      title="編集"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1 rounded hover:bg-red-50 text-xs text-red-500"
                      title="削除"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add prompt */}
      {showAdd ? (
        <div className="p-4 rounded-lg border border-dashed border-border space-y-3">
          <select
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] resize-none"
            placeholder="プロンプトを入力..."
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>追加</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>キャンセル</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="w-full">
          + プロンプトを追加
        </Button>
      )}
    </div>
  )
}
