import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import {
  generateUseCaseProfile,
  computeCategoryDistribution,
  generatePromptSet,
} from '@/lib/eval/prompt-generator'
import type { HearingAnswers } from '@/lib/eval/types'

// Allow up to 120s for LLM calls (Stage 1 + Stage 3)
export const maxDuration = 120

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await prisma.evalProject.findFirst({
      where: { id: params.id, userId: user.id },
    })
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { answers } = await req.json() as { answers: HearingAnswers }

    // Stage 1: Generate use case profile
    console.log('[generate] Stage 1: generating use case profile...')
    const profile = await generateUseCaseProfile(answers, user.id)
    console.log('[generate] Stage 1 complete:', profile.domain)

    // Save profile to project
    await prisma.evalProject.update({
      where: { id: params.id },
      data: { useCaseProfile: profile as any },
    })

    // Stage 2: Compute category distribution
    const distribution = computeCategoryDistribution(profile.priority)
    console.log('[generate] Stage 2 complete:', distribution)

    // Stage 3: Generate prompt set
    console.log('[generate] Stage 3: generating prompts...')
    const generatedPrompts = await generatePromptSet(profile, distribution, user.id)
    console.log('[generate] Stage 3 complete:', generatedPrompts.length, 'prompts')

    // Delete existing prompt sets for this project
    await prisma.promptSet.deleteMany({ where: { projectId: params.id } })

    // Save to DB
    const promptSet = await prisma.promptSet.create({
      data: {
        projectId: params.id,
        source: 'GENERATED',
        generationConfig: { answers, profile, distribution } as any,
        promptItems: {
          create: generatedPrompts.map((p, index) => ({
            category: (p.category.toUpperCase() as any) || 'GENERAL',
            prompt: p.prompt,
            evaluationFocus: p.evaluation_focus || '',
            goldStandardHint: p.gold_standard_hint || null,
            orderIndex: index,
          })),
        },
      },
      include: { promptItems: { orderBy: { orderIndex: 'asc' } } },
    })

    return NextResponse.json(promptSet)
  } catch (error) {
    console.error('Prompt generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'プロンプト生成に失敗しました' },
      { status: 500 }
    )
  }
}
