import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = await getUserId()

  const room = await prisma.room.findFirst({
    where: { id: params.id, userId },
    include: {
      userMessages: {
        orderBy: { orderIndex: 'asc' },
        include: {
          modelRuns: {
            include: { assistantMessage: true },
          },
          integrateResults: {
            orderBy: { createdAt: 'desc' },
            take: 1,
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
  const userId = await getUserId()

  const body = await req.json()
  const room = await prisma.room.updateMany({
    where: { id: params.id, userId },
    data: { title: body.title, isArchived: body.isArchived },
  })
  return NextResponse.json(room)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = await getUserId()

  await prisma.room.updateMany({
    where: { id: params.id, userId },
    data: { isArchived: true },
  })
  return NextResponse.json({ success: true })
}
