import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, any> = {}

  // 環境変数チェック
  checks.envVars = {
    DATABASE_URL: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@') : 'MISSING',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'set' : 'MISSING',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? 'set' : 'MISSING',
  }

  // DB接続チェック
  try {
    const result = await prisma.$queryRaw`SELECT 1 as ok`
    checks.database = { status: 'connected', result }
  } catch (err: any) {
    checks.database = { status: 'error', message: err.message }
  }

  // Projects カウント
  try {
    const count = await prisma.evalProject.count()
    checks.projects = { count }
  } catch (err: any) {
    checks.projects = { status: 'error', message: err.message }
  }

  return NextResponse.json(checks)
}
