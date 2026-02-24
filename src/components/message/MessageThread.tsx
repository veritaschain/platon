'use client'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useMessageStore, type ModelRun } from '@/stores/message-store'
import { useConnectorStore } from '@/stores/connector-store'
import { ResponseCard } from './ResponseCard'
import { HandoffComment } from './HandoffComment'
import { IntegrateCard } from '@/components/integrate/IntegrateCard'
import { HandoffDialog } from '@/components/handoff/HandoffDialog'
import { Button } from '@/components/common/Button'
import { Sparkles, Merge } from 'lucide-react'

interface MessageThreadProps {
  roomId: string
  messages: NonNullable<ReturnType<typeof useMessageStore.getState>['messages']>
}

/**
 * Split modelRuns into original responses and handoff results.
 * For debate, build a chain: counter -> rebuttal (nested).
 * Returns: { originals, handoffsBySource }
 *   handoffsBySource maps sourceModelRunId -> array of top-level handoff runs
 *   each run may have children (e.g. rebuttal is child of counter's source)
 */
function splitRuns(runs: ModelRun[]) {
  const originals: ModelRun[] = []
  const handoffs: ModelRun[] = []

  for (const run of runs) {
    if (run.handoffInfo) {
      handoffs.push(run)
    } else {
      originals.push(run)
    }
  }

  // Group handoff runs by their sourceModelRunId
  // For debate: counter's source is the original run, rebuttal's source is also the original run
  // We need to figure out nesting: if a handoff's source is another handoff, nest it
  const handoffById = new Map(handoffs.map(h => [h.id, h]))
  const handoffSourceSet = new Set(handoffs.map(h => h.handoffInfo!.sourceModelRunId))

  // Top-level handoffs: source is an original (not another handoff)
  const topLevel: ModelRun[] = []
  const childrenMap = new Map<string, ModelRun[]>()

  for (const h of handoffs) {
    const sourceId = h.handoffInfo!.sourceModelRunId
    if (handoffById.has(sourceId)) {
      // This handoff's source is another handoff -> it's a child (rebuttal)
      const existing = childrenMap.get(sourceId) ?? []
      existing.push(h)
      childrenMap.set(sourceId, existing)
    } else {
      topLevel.push(h)
    }
  }

  // Group top-level handoffs by source
  const handoffsBySource = new Map<string, { run: ModelRun; children: ModelRun[] }[]>()
  for (const h of topLevel) {
    const sourceId = h.handoffInfo!.sourceModelRunId
    const existing = handoffsBySource.get(sourceId) ?? []
    existing.push({ run: h, children: childrenMap.get(h.id) ?? [] })
    handoffsBySource.set(sourceId, existing)
  }

  return { originals, handoffsBySource }
}

export function MessageThread({ roomId, messages }: MessageThreadProps) {
  const { executeIntegrate, setMessages } = useMessageStore()
  const { advancedMode } = useConnectorStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [handoffDialog, setHandoffDialog] = useState<{ runId: string; model: string; type: 'verify' | 'debate' } | null>(null)
  const [integratingIds, setIntegratingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleVerify = (runId: string, model: string) => {
    setHandoffDialog({ runId, model, type: 'verify' })
  }

  const handleDebate = (runId: string, model: string) => {
    setHandoffDialog({ runId, model, type: 'debate' })
  }

  const refreshRoomData = async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}`)
      if (!res.ok) return
      const room = await res.json()
      if (!room.userMessages) return

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

      const msgs = room.userMessages.map((m: any) => ({
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
      }))
      setMessages(msgs)
    } catch (err) {
      console.error('[refreshRoomData]', err)
    }
  }

  const handleHandoffExecute = async (runId: string, targetModel: string, userOverride?: string) => {
    if (!handoffDialog) return
    const endpoint = handoffDialog.type === 'verify' ? '/api/handoffs' : '/api/handoffs/debate'
    const body = handoffDialog.type === 'verify'
      ? { sourceModelRunId: runId, targetModel, userOverride, roomId }
      : { sourceModelRunId: runId, opponentModel: targetModel, roomId }

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    // Refresh room data to pick up new handoff results
    await refreshRoomData()
  }

  const handleIntegrate = async (userMessageId: string) => {
    setIntegratingIds(s => new Set([...s, userMessageId]))
    await executeIntegrate(userMessageId, roomId)
    setIntegratingIds(s => { const next = new Set(s); next.delete(userMessageId); return next })
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <div className="text-4xl mb-3">🤖</div>
          <h3 className="font-semibold text-gray-700 mb-1">複数AIの思考を統合するエンジン</h3>
          <p className="text-sm text-gray-500">モードを選んでメッセージを送信してください</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {messages.map(msg => {
        const { originals, handoffsBySource } = splitRuns(msg.modelRuns)

        return (
          <div key={msg.id} className="space-y-3">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[70%] bg-gray-900 text-white rounded-2xl rounded-tr-sm px-4 py-2 text-sm">
                {msg.content}
                {msg.mode && (
                  <div className="text-xs text-gray-400 mt-1">
                    {msg.mode === 'verify' ? '厳密検証モード' : '多角的レビューモード'}
                  </div>
                )}
              </div>
            </div>

            {/* AI responses - only originals in grid */}
            <div className={`grid gap-3 ${originals.length > 1 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-3xl'}`}>
              {originals.map(run => (
                <div key={run.id}>
                  <ResponseCard
                    run={run}
                    showHandoffButtons={advancedMode && run.status === 'COMPLETED'}
                    onVerify={advancedMode ? () => handleVerify(run.id, run.model) : undefined}
                    onDebate={advancedMode ? () => handleDebate(run.id, run.model) : undefined}
                  />

                  {/* Handoff results as collapsible comments */}
                  {handoffsBySource.get(run.id)?.map(({ run: handoffRun, children }) => (
                    <HandoffComment
                      key={handoffRun.id}
                      run={handoffRun}
                      children={children}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Integrate button / result */}
            {originals.filter(r => r.status === 'COMPLETED').length >= 2 && !msg.integrateResult && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleIntegrate(msg.id)}
                  disabled={integratingIds.has(msg.id)}
                  className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                >
                  <Sparkles size={14} />
                  {integratingIds.has(msg.id) ? '統合中...' : '回答を統合する'}
                </Button>
              </div>
            )}

            {msg.integrateResult && (
              <div className="max-w-3xl">
                <IntegrateCard result={msg.integrateResult} />
              </div>
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />

      {handoffDialog && (
        <HandoffDialog
          runId={handoffDialog.runId}
          sourceModel={handoffDialog.model}
          type={handoffDialog.type}
          onClose={() => setHandoffDialog(null)}
          onExecute={handleHandoffExecute}
        />
      )}
    </div>
  )
}
