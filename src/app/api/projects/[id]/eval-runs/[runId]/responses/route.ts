import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _: Request,
  { params }: { params: { id: string; runId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const responses = await prisma.modelResponse.findMany({
    where: { evalRunId: params.runId },
    include: {
      judgeScore: true,
      promptItem: true,
    },
    orderBy: [
      { promptItem: { orderIndex: 'asc' } },
      { model: 'asc' },
    ],
  })

  return NextResponse.json(responses)
}
