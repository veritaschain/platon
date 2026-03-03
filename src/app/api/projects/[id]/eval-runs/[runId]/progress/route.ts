import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _: Request,
  { params }: { params: { id: string; runId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) {
    return new Response('Not found', { status: 404 })
  }

  // SSE stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let lastCount = 0

      const poll = async () => {
        try {
          const run = await prisma.evalRun.findUnique({
            where: { id: params.runId },
            include: {
              _count: { select: { modelResponses: true } },
              promptSet: { include: { _count: { select: { promptItems: true } } } },
            },
          })

          if (!run) {
            send({ type: 'error', message: '評価ランが見つかりません' })
            controller.close()
            return
          }

          const totalPrompts = run.promptSet._count.promptItems
          const totalModels = run.targetModels.length
          const totalCount = totalPrompts * totalModels
          const completedCount = run._count.modelResponses

          if (completedCount !== lastCount) {
            lastCount = completedCount
            send({
              type: run.status === 'SCORING' ? 'scoring_start' : 'response_complete',
              completedCount,
              totalCount,
              totalPrompts,
              totalModels,
              message: run.status === 'SCORING'
                ? '品質採点中...'
                : `${completedCount}/${totalCount} 完了`,
            })
          }

          if (run.status === 'COMPLETED') {
            send({ type: 'complete', message: '評価が完了しました' })
            controller.close()
            return
          }

          if (run.status === 'FAILED') {
            send({ type: 'error', message: '評価中にエラーが発生しました' })
            controller.close()
            return
          }

          // Continue polling
          setTimeout(poll, 1000)
        } catch {
          controller.close()
        }
      }

      poll()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
