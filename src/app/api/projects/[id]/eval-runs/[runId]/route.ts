import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; runId: string }> }
) {
  const params = await paramsPromise
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const run = await prisma.evalRun.findUnique({
    where: { id: params.runId, projectId: params.id, project: { userId: user.id } },
    include: {
      _count: {
        select: { modelResponses: true },
      },
    },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(run)
}
