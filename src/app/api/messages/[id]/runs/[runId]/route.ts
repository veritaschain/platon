import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function GET(_: Request, { params }: { params: { id: string; runId: string } }) {
  const userId = await getUserId()

  const run = await prisma.modelRun.findFirst({
    where: {
      id: params.runId,
      userMessageId: params.id,
    },
    include: { assistantMessage: true },
  })

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  return NextResponse.json(run)
}
