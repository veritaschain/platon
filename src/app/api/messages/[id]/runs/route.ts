import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const runs = await prisma.modelRun.findMany({
    where: { userMessageId: params.id },
    include: { assistantMessage: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(runs)
}
