import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: { id: string; runId: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
