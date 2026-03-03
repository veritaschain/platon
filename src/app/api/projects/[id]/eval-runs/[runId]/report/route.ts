import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _: Request,
  { params }: { params: { id: string; runId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.evalProject.findFirst({
    where: { id: params.id, userId: user.id },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const report = await prisma.evalReport.findUnique({
    where: { evalRunId: params.runId },
  })
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  return NextResponse.json({
    rankings: report.rankings,
    scoreMatrix: report.scoreMatrix,
    highlights: report.highlights,
    costProjection: report.costProjection,
    recommendation: report.recommendation,
  })
}
