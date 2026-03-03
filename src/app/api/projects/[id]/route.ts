import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      promptSets: {
        include: { promptItems: { orderBy: { orderIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      evalRuns: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(project)
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const updated = await prisma.evalProject.updateMany({
    where: { id: params.id, userId: user.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isArchived !== undefined && { isArchived: body.isArchived }),
      ...(body.useCaseProfile !== undefined && { useCaseProfile: body.useCaseProfile }),
      ...(body.status !== undefined && { status: body.status }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.evalProject.updateMany({
    where: { id: params.id, userId: user.id },
    data: { isArchived: true },
  })
  return NextResponse.json({ success: true })
}
