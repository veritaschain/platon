import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'
import { decrypt } from '@/lib/crypto/encryption'
import { logEvent } from '@/lib/governance/event-logger'
import { maskPII } from '@/lib/governance/pii-masker'
import { checkAndDegrade } from '@/lib/governance/cost-controller'
import { detectLoop } from '@/lib/governance/loop-detector'
import { executeIntegrate } from '@/lib/integrate'

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userMessageId, roomId } = await req.json()

  // 対象メッセージの全完了済みModelRunを取得
  const runs = await prisma.modelRun.findMany({
    where: { userMessageId, status: 'COMPLETED' },
    include: { assistantMessage: true },
  })

  if (runs.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 completed model runs' }, { status: 400 })
  }

  // ループ検出: 同一内容の繰り返しチェック
  const contents = runs
    .filter(r => r.assistantMessage)
    .map(r => r.assistantMessage!.content)
  if (detectLoop(contents)) {
    return NextResponse.json({ error: 'Loop detected: duplicate responses' }, { status: 400 })
  }

  // PIIマスキングを適用してからINTEGRATEに渡す
  const responses = runs
    .filter(r => r.assistantMessage)
    .map(r => {
      const { masked } = maskPII(r.assistantMessage!.content)
      return { modelName: r.model, content: masked }
    })

  // APIキー取得
  const apiKeys = await prisma.userApiKey.findMany({
    where: { userId: user.id, isActive: true },
  })
  const keyMap: Record<string, string> = {}
  for (const k of apiKeys) keyMap[k.provider] = decrypt(k.encryptedKey)

  try {
    const output = await executeIntegrate({ userMessageId, responses }, keyMap)

    // 保存
    const integrateResult = await prisma.integrateResult.create({
      data: {
        userMessageId,
        step1Extractions: output.step1Extractions as object,
        step15TrustStructure: output.step15TrustStructure as object,
        step15Conflicts: output.step15Conflicts as object,
        step2Prompt: output.step2Prompt,
        step2Output: output.step2Output,
        fallbackUsed: output.fallbackUsed,
      },
    })

    await logEvent(user.id, roomId, 'integrate', {
      integrateResultId: integrateResult.id,
      fallbackUsed: output.fallbackUsed,
      modelCount: runs.length,
    })

    return NextResponse.json({ integrateResultId: integrateResult.id, output })
  } catch (error) {
    console.error('[Integrate FAILED]', error)
    return NextResponse.json({ error: 'Integration failed' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const userMessageId = url.searchParams.get('userMessageId')
  if (!userMessageId) return NextResponse.json({ error: 'Missing userMessageId' }, { status: 400 })

  const result = await prisma.integrateResult.findFirst({
    where: { userMessageId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(result)
}
