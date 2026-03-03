import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify project ownership
  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const promptSet = await prisma.promptSet.findFirst({
    where: { projectId: params.id },
    include: { promptItems: { orderBy: { orderIndex: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })

  if (!promptSet) return NextResponse.json(null)
  return NextResponse.json(promptSet)
}
