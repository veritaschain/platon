import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; itemId: string }> }
) {
  const params = await paramsPromise
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify project ownership
  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  try {
    const updated = await prisma.promptItem.update({
      where: { id: params.itemId, promptSet: { projectId: params.id, project: { userId: user.id } } },
      data: {
        ...(body.prompt !== undefined && { prompt: body.prompt }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.evaluationFocus !== undefined && { evaluationFocus: body.evaluationFocus }),
        ...(body.goldStandardHint !== undefined && { goldStandardHint: body.goldStandardHint }),
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (isMissingRecord(error)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw error
  }
}

export async function DELETE(
  _: Request,
  { params: paramsPromise }: { params: Promise<{ id: string; itemId: string }> }
) {
  const params = await paramsPromise
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await prisma.promptItem.delete({ where: { id: params.itemId, promptSet: { projectId: params.id, project: { userId: user.id } } } })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (isMissingRecord(error)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw error
  }
}

function isMissingRecord(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'
}
