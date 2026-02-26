import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const period = url.searchParams.get('period') ?? 'month'

  const now = new Date()
  let startDate: Date

  switch (period) {
    case 'day':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)
      break
    case 'month':
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
  }

  const logs = await prisma.usageLog.findMany({
    where: { userId: user.id, createdAt: { gte: startDate } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostUsd: true,
      createdAt: true,
    },
  })

  const totalCost = logs.reduce((sum, l) => sum + Number(l.estimatedCostUsd ?? 0), 0)
  const totalTokens = logs.reduce((sum, l) => sum + l.inputTokens + l.outputTokens, 0)

  return NextResponse.json({
    period,
    totalCost,
    totalTokens,
    count: logs.length,
    logs,
  })
}
