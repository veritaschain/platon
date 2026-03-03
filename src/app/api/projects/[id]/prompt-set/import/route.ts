import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'
import Papa from 'papaparse'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'ファイルが必要です' }, { status: 400 })

    const text = await file.text()
    const isJson = file.name.endsWith('.json')

    let items: { prompt: string; category?: string; gold_standard_hint?: string }[]

    if (isJson) {
      items = JSON.parse(text)
      if (!Array.isArray(items)) {
        return NextResponse.json({ error: 'JSON配列形式が必要です' }, { status: 400 })
      }
    } else {
      // CSV
      const parsed = Papa.parse<{ prompt: string; category?: string; gold_standard_hint?: string }>(text, {
        header: true,
        skipEmptyLines: true,
      })
      items = parsed.data
    }

    // Validate
    const validItems = items.filter(item => item.prompt && item.prompt.trim().length > 0)
    if (validItems.length === 0) {
      return NextResponse.json({ error: '有効なプロンプトが見つかりません' }, { status: 400 })
    }

    // Delete existing prompt sets
    await prisma.promptSet.deleteMany({ where: { projectId: params.id } })

    // Create prompt set
    const promptSet = await prisma.promptSet.create({
      data: {
        projectId: params.id,
        source: 'IMPORTED',
        promptItems: {
          create: validItems.map((item, index) => ({
            category: normalizeCategory(item.category),
            prompt: item.prompt.trim(),
            evaluationFocus: '',
            goldStandardHint: item.gold_standard_hint || null,
            orderIndex: index,
          })),
        },
      },
      include: { promptItems: { orderBy: { orderIndex: 'asc' } } },
    })

    return NextResponse.json(promptSet)
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'インポートに失敗しました' },
      { status: 500 }
    )
  }
}

function normalizeCategory(category?: string): any {
  if (!category) return 'GENERAL'
  const upper = category.toUpperCase().trim()
  const valid = ['ACCURACY', 'RELEVANCE', 'CONCISENESS', 'TONE', 'INSTRUCTION', 'EDGE_CASE', 'GENERAL']
  return valid.includes(upper) ? upper : 'GENERAL'
}
