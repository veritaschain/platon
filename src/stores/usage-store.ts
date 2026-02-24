import { create } from 'zustand'

interface UsageStore {
  daily: number
  monthly: number
  dailyPercent: number
  monthlyPercent: number
  limits: { DAILY_USD: number; MONTHLY_USD: number }
  fetchUsage: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set) => ({
  daily: 0,
  monthly: 0,
  dailyPercent: 0,
  monthlyPercent: 0,
  limits: { DAILY_USD: 5, MONTHLY_USD: 20 },

  fetchUsage: async () => {
    try {
      const res = await fetch('/api/usage/limits')
      if (res.ok) {
        const data = await res.json()
        set({
          daily: data.daily ?? 0,
          monthly: data.monthly ?? 0,
          dailyPercent: data.dailyPercent ?? 0,
          monthlyPercent: data.monthlyPercent ?? 0,
        })
      }
    } catch {
      // API未認証・ネットワークエラー時はデフォルト値のまま
    }
  },
}))
