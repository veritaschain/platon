import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function GET() {
  const userId = await getUserId()

  const rooms = await prisma.room.findMany({
    where: { userId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(rooms)
}

export async function POST(req: Request) {
  const userId = await getUserId()

  const { title } = await req.json()
  const room = await prisma.room.create({
    data: { userId, title: title ?? '新しい会話' },
  })
  return NextResponse.json(room)
}
