import { NextResponse } from 'next/server'
import { getUsage, LIMITS } from '@/lib/governance/cost-controller'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const usage = await getUsage(user.id)
  const dailyPercent = (usage.daily / LIMITS.DAILY_USD) * 100
  const monthlyPercent = (usage.monthly / LIMITS.MONTHLY_USD) * 100
  const isBlocked = usage.daily >= LIMITS.DAILY_USD || usage.monthly >= LIMITS.MONTHLY_USD
  const dailyUsd = usage.daily
  const monthlyUsd = usage.monthly

  return NextResponse.json({
    ...usage,
    dailyUsd,
    monthlyUsd,
    dailyPercent,
    monthlyPercent,
    isBlocked,
  })
}
