import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; itemId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify project ownership
  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updated = await prisma.promptItem.update({
    where: { id: params.itemId },
    data: {
      ...(body.prompt !== undefined && { prompt: body.prompt }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.evaluationFocus !== undefined && { evaluationFocus: body.evaluationFocus }),
      ...(body.goldStandardHint !== undefined && { goldStandardHint: body.goldStandardHint }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _: Request,
  { params }: { params: { id: string; itemId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.promptItem.delete({ where: { id: params.itemId } })
  return NextResponse.json({ success: true })
}
