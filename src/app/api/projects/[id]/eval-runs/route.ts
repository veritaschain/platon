import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import { estimateEvalCost } from '@/lib/eval/execution-engine'
import { runFullEvaluation } from '@/lib/eval/orchestrator'
import { getDailyMonthlyUsage } from '@/lib/db/usage'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const runs = await prisma.evalRun.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(runs)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { targetModels, judgeModel } = await req.json()

  if (!targetModels?.length || !judgeModel) {
    return NextResponse.json(
      { error: '対象モデルとジャッジモデルが必要です' },
      { status: 400 }
    )
  }

  // Get prompt set
  const promptSet = await prisma.promptSet.findFirst({
    where: { projectId: params.id },
    include: { _count: { select: { promptItems: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (!promptSet || promptSet._count.promptItems === 0) {
    return NextResponse.json(
      { error: 'プロンプトセットが必要です' },
      { status: 400 }
    )
  }

  // Cost check
  const estimatedCost = estimateEvalCost(promptSet._count.promptItems, targetModels, judgeModel)
  const { dailyUsed, monthlyUsed } = await getDailyMonthlyUsage(user.id)

  if (dailyUsed + estimatedCost > 5) {
    return NextResponse.json(
      { error: '日次コスト上限($5)を超過します。対象モデルを減らしてください。' },
      { status: 429 }
    )
  }
  if (monthlyUsed + estimatedCost > 20) {
    return NextResponse.json(
      { error: '月次コスト上限($20)を超過します。' },
      { status: 429 }
    )
  }

  // Create eval run (execution is triggered by SSE /progress endpoint)
  const evalRun = await prisma.evalRun.create({
    data: {
      projectId: params.id,
      promptSetId: promptSet.id,
      targetModels,
      judgeModel,
      estimatedCostUsd: estimatedCost,
    },
  })

  return NextResponse.json({ runId: evalRun.id, estimatedCost })
}
