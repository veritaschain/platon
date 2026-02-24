import { prisma } from '@/lib/db/client'
import type { Provider } from '@/lib/connectors/types'

export const LIMITS = {
  DAILY_USD: 5,
  MONTHLY_USD: 20,
  MAX_OUTPUT_TOKENS: 4096,
}

const LITE_FALLBACK: Record<string, string> = {
  'gpt-4o': 'gpt-4o-mini',
  'claude-sonnet-4-20250514': 'claude-haiku-4-5-20251001',
  'gemini-2.5-pro': 'gemini-2.5-flash',
}

export async function checkAndDegrade(
  userId: string,
  model: string,
  provider: Provider
): Promise<{ model: string; provider: Provider; degraded: boolean }> {
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [daily, monthly] = await Promise.all([
    prisma.usageLog.aggregate({
      where: { userId, createdAt: { gte: dayStart } },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.usageLog.aggregate({
      where: { userId, createdAt: { gte: monthStart } },
      _sum: { estimatedCostUsd: true },
    }),
  ])

  const dailyTotal = Number(daily._sum.estimatedCostUsd ?? 0)
  const monthlyTotal = Number(monthly._sum.estimatedCostUsd ?? 0)

  const shouldDegrade = dailyTotal >= LIMITS.DAILY_USD * 0.8 || monthlyTotal >= LIMITS.MONTHLY_USD * 0.8
  if (shouldDegrade && LITE_FALLBACK[model]) {
    return { model: LITE_FALLBACK[model], provider, degraded: true }
  }
  return { model, provider, degraded: false }
}

export async function getUsage(userId: string) {
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [daily, monthly] = await Promise.all([
    prisma.usageLog.aggregate({
      where: { userId, createdAt: { gte: dayStart } },
      _sum: { estimatedCostUsd: true },
    }),
    prisma.usageLog.aggregate({
      where: { userId, createdAt: { gte: monthStart } },
      _sum: { estimatedCostUsd: true },
    }),
  ])

  return {
    daily: Number(daily._sum.estimatedCostUsd ?? 0),
    monthly: Number(monthly._sum.estimatedCostUsd ?? 0),
    limits: LIMITS,
  }
}
