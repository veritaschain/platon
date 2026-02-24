import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getAuthenticatedUser, unauthorizedResponse, serverErrorResponse } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: { roomId: string } }) {
  const { user, error } = await getAuthenticatedUser()
  if (error || !user) return unauthorizedResponse()

  try {
    const handoffs = await prisma.handoff.findMany({
      where: { roomId: params.roomId, room: { userId: user.id } },
      orderBy: { createdAt: 'asc' },
      include: {
        sourceModelRun: { include: { assistantMessage: true } },
        targetModelRun: { include: { assistantMessage: true } },
      },
    })
    return NextResponse.json({ handoffs })
  } catch (err) {
    console.error('[Handoffs/:roomId GET]', err)
    return serverErrorResponse()
  }
}
