import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const room = await prisma.room.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      userMessages: {
        orderBy: { orderIndex: 'asc' },
        include: {
          modelRuns: {
            include: { assistantMessage: true },
          },
        },
      },
      handoffs: {
        select: {
          id: true,
          sourceModelRunId: true,
          targetModelRunId: true,
          templateType: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(room)
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const room = await prisma.room.updateMany({
    where: { id: params.id, userId: user.id },
    data: { title: body.title, isArchived: body.isArchived },
  })
  return NextResponse.json(room)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.room.updateMany({
    where: { id: params.id, userId: user.id },
    data: { isArchived: true },
  })
  return NextResponse.json({ success: true })
}
