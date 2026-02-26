import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = await getUserId()

  const result = await prisma.integrateResult.findUnique({
    where: { id: params.id },
    include: {
      userMessage: {
        select: { id: true, content: true, roomId: true, room: { select: { userId: true } } },
      },
    },
  })

  if (!result) {
    return NextResponse.json({ error: 'IntegrateResult not found' }, { status: 404 })
  }

  // RLS: ユーザー所有チェック
  if (result.userMessage.room.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(result)
}
