import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rooms = await prisma.room.findMany({
    where: { userId: user.id, isArchived: false },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(rooms)
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title } = await req.json()
  const room = await prisma.room.create({
    data: { userId: user.id, title: title ?? '新しい会話' },
  })
  return NextResponse.json(room)
}
