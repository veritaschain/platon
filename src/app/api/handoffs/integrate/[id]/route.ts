import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  if (result.userMessage.room.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json(result)
}
