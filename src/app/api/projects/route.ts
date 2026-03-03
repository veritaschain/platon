import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = await prisma.evalProject.findMany({
    where: { userId: user.id, isArchived: false },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(projects)
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json()
  const project = await prisma.evalProject.create({
    data: { userId: user.id, name: name || '新規プロジェクト' },
  })
  return NextResponse.json(project)
}
