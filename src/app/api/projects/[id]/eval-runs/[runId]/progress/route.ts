import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import { runFullEvaluation } from '@/lib/eval/orchestrator'

export const maxDuration = 300

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

  const evalRun = await prisma.evalRun.findUnique({
    where: { id: params.runId },
  })
  if (!evalRun) {
    return new Response('Run not found', { status: 404 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller already closed
        }
      }

      // If run is already completed or failed, send final status and close
      if (evalRun.status === 'COMPLETED') {
        send({ type: 'complete', message: '評価が完了しました' })
        controller.close()
        return
      }
      if (evalRun.status === 'FAILED') {
        send({ type: 'error', message: '評価中にエラーが発生しました' })
        controller.close()
        return
      }

      // Run is PENDING or RUNNING — execute evaluation within this SSE stream
      // This keeps the Lambda alive while streaming progress back to the client
      try {
        console.log('[progress] Starting evaluation within SSE stream for run:', params.runId)

        await runFullEvaluation(evalRun.id, user.id, (event) => {
          send(event)
        })

        send({ type: 'complete', message: '評価が完了しました' })
      } catch (error) {
        console.error('[progress] Evaluation error:', error)
        send({
          type: 'error',
          message: error instanceof Error ? error.message : '評価中にエラーが発生しました',
        })
      }

      controller.close()
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
