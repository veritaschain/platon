import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import {
  generateUseCaseProfile,
  computeCategoryDistribution,
  generatePromptBatch,
  splitIntoBatches,
} from '@/lib/eval/prompt-generator'
import type { PromptCategory } from '@prisma/client'
import type { HearingAnswers, UseCaseProfile, GeneratedPrompt } from '@/lib/eval/types'

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
    // Step 1: Profile + Distribution (ルールベース、即座に完了)
    // ============================================================
    if (!step || step === 'profile') {
      const { answers } = body as { answers: HearingAnswers }

      console.log('[generate] Stage 1: generating use case profile (rule-based)...')
      const profile = generateUseCaseProfile(answers)
      console.log('[generate] Stage 1 complete:', profile.domain)

      await prisma.evalProject.update({
        where: { id: params.id },
        data: { useCaseProfile: profile as any },
      })

      const distribution = computeCategoryDistribution(profile.priority)
      const batches = splitIntoBatches(distribution)

      return NextResponse.json({
        step: 'profile_done',
        profile,
        distribution,
        batches,
        totalBatches: batches.length,
      })
    }

    // ============================================================
    // Step 2: Generate one batch of prompts (LLM 1回, ~5-8s)
    // ============================================================
    if (step === 'batch') {
      const { profile, batchCategories, batchIndex } = body as {
        profile: UseCaseProfile
        batchCategories: { category: PromptCategory; count: number }[]
        batchIndex: number
      }

      console.log(`[generate] Batch ${batchIndex}: generating prompts...`, batchCategories)
      const prompts = await generatePromptBatch(profile, batchCategories, user.id, batchIndex)
      console.log(`[generate] Batch ${batchIndex} complete:`, prompts.length, 'prompts')

      return NextResponse.json({ prompts, batchIndex })
    }

    // ============================================================
    // Step 3: Save all generated prompts to DB
    // ============================================================
    if (step === 'save') {
      const { answers, profile, distribution, allPrompts } = body as {
        answers: HearingAnswers
        profile: UseCaseProfile
        distribution: Record<string, number>
        allPrompts: GeneratedPrompt[]
      }

      console.log('[generate] Saving', allPrompts.length, 'prompts to DB...')

      // Delete existing prompt sets for this project
      await prisma.promptSet.deleteMany({ where: { projectId: params.id } })

      // Save to DB
      const promptSet = await prisma.promptSet.create({
        data: {
          projectId: params.id,
          source: 'GENERATED',
          generationConfig: { answers, profile, distribution } as any,
          promptItems: {
            create: allPrompts.map((p, index) => ({
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
