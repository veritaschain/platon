import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getUserId } from '@/lib/auth'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const userId = await getUserId()

  const runs = await prisma.modelRun.findMany({
    where: { userMessageId: params.id },
    include: { assistantMessage: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(runs)
}
