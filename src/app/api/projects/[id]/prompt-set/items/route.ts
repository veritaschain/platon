import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const promptSet = await prisma.promptSet.findFirst({
    where: { projectId: params.id },
    include: { promptItems: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!promptSet) return NextResponse.json({ error: 'PromptSet not found' }, { status: 404 })

  const body = await req.json()
  const newItem = await prisma.promptItem.create({
    data: {
      promptSetId: promptSet.id,
      category: body.category || 'GENERAL',
      prompt: body.prompt,
      evaluationFocus: body.evaluationFocus || '',
      goldStandardHint: body.goldStandardHint || null,
      orderIndex: promptSet.promptItems.length,
    },
  })

  return NextResponse.json(newItem)
}
