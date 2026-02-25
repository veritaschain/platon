'use client'
import { useEffect } from 'react'
import { useRoomStore } from '@/stores/room-store'
import { useMessageStore } from '@/stores/message-store'
import { useConnectorStore } from '@/stores/connector-store'
import { MessageThread } from '@/components/message/MessageThread'
import { MessageInput } from '@/components/message/MessageInput'
import { RightPanel } from '@/components/common/RightPanel'
import { Settings } from 'lucide-react'
import Link from 'next/link'

export default function ChatPage() {
  const { activeRoomId, createRoom } = useRoomStore()
  const { messages, setMessages } = useMessageStore()
  const { advancedMode, setAdvancedMode, fetchApiKeys } = useConnectorStore()

  useEffect(() => { fetchApiKeys() }, [])

  useEffect(() => {
    if (!activeRoomId) {
      setMessages([])
      return
    }
    // Fetch room messages into Zustand store
    fetch(`/api/rooms/${activeRoomId}`)
      .then(r => r.json())
      .then(room => {
        if (room.userMessages) {
          // Build a lookup: targetModelRunId -> { sourceModelRunId, templateType }
          const handoffMap = new Map<string, { sourceModelRunId: string; templateType: string }>()
          if (room.handoffs) {
            for (const h of room.handoffs) {
              if (h.targetModelRunId) {
                handoffMap.set(h.targetModelRunId, {
                  sourceModelRunId: h.sourceModelRunId,
                  templateType: h.templateType,
                })
              }
            }
          }

          const msgs = room.userMessages.map((m: any) => {
            const ir = m.integrateResults?.[0] ?? null
            return {
              id: m.id,
              roomId: m.roomId,
              content: m.content,
              mode: m.mode,
              orderIndex: m.orderIndex,
              modelRuns: (m.modelRuns ?? []).map((r: any) => ({
                ...r,
                estimatedCostUsd: r.estimatedCostUsd ? Number(r.estimatedCostUsd) : undefined,
                handoffInfo: handoffMap.get(r.id) ?? undefined,
              })),
              integrateResult: ir ? {
                id: ir.id,
                step1Extractions: ir.step1Extractions,
                step15TrustStructure: ir.step15TrustStructure,
                step15Conflicts: ir.step15Conflicts,
                step2Output: ir.step2Output,
                fallbackUsed: ir.fallbackUsed,
              } : null,
            }
          })
          setMessages(msgs)
        }
      })
      .catch(() => setMessages([]))
  }, [activeRoomId])

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
          <div className="text-sm text-gray-600">
            {activeRoomId ? '会話中' : 'ルームを選択してください'}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
                className="rounded"
              />
              上級者モード
            </label>
            <Link href="/settings" className="text-gray-400 hover:text-gray-600">
              <Settings size={16} />
            </Link>
          </div>
        </div>

        {activeRoomId ? (
          <>
            <MessageThread roomId={activeRoomId} messages={messages} />
            <MessageInput roomId={activeRoomId} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">🧠</div>
              <h2 className="font-bold text-xl text-gray-800 mb-2">複数AIの思考を統合するエンジン</h2>
              <p className="text-gray-500 mb-4">新しい会話を開始してください</p>
              <button
                onClick={() => createRoom()}
                className="bg-gray-900 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors text-sm"
              >
                新しい会話を始める
              </button>
            </div>
          </div>
        )}
      </div>

      <RightPanel />
    </div>
  )
}
