import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const userId = await getUserId()

  await prisma.userApiKey.updateMany({
    where: { id: params.id, userId },
    data: { isActive: false },
  })
  return NextResponse.json({ success: true })
}
