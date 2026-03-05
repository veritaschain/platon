import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import {
  generateUseCaseProfile,
  computeCategoryDistribution,
  generatePromptSet,
} from '@/lib/eval/prompt-generator'
import type { HearingAnswers, UseCaseProfile, CategoryDistribution } from '@/lib/eval/types'

// Allow up to 120s for LLM calls
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

    const body = await req.json()
    const { step } = body as { step?: string }

    // ============================================================
    // Step 1: Hearing answers → UseCaseProfile + Distribution (~6s)
    // ============================================================
    if (!step || step === 'profile') {
      const { answers } = body as { answers: HearingAnswers }

      console.log('[generate] Stage 1: generating use case profile...')
      const profile = await generateUseCaseProfile(answers, user.id)
      console.log('[generate] Stage 1 complete:', profile.domain)

      await prisma.evalProject.update({
        where: { id: params.id },
        data: { useCaseProfile: profile as any },
      })

      const distribution = computeCategoryDistribution(profile.priority)

      return NextResponse.json({ step: 'profile_done', profile, distribution })
    }

    // ============================================================
    // Step 2: Profile + Distribution → Prompt Set (~20-25s)
    // ============================================================
    if (step === 'prompts') {
      const { profile, distribution, answers } = body as {
        profile: UseCaseProfile
        distribution: CategoryDistribution
        answers: HearingAnswers
      }

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
    }

    return NextResponse.json({ error: '不正なstepパラメータ' }, { status: 400 })
  } catch (error) {
    console.error('Prompt generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'プロンプト生成に失敗しました' },
      { status: 500 }
    )
  }
}
