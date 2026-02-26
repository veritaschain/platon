import { NextResponse } from 'next/server'
import { getUsage, LIMITS } from '@/lib/governance/cost-controller'
import { getUserId } from '@/lib/auth'

export async function GET() {
  const userId = await getUserId()

  const usage = await getUsage(userId)
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
