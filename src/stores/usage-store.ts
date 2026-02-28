import { create } from 'zustand'

export type Currency = 'USD' | 'JPY' | 'EUR' | 'CNY' | 'GBP'
const CURRENCY_ORDER: Currency[] = ['USD', 'JPY', 'EUR', 'CNY', 'GBP']

interface UsageStore {
  daily: number
  monthly: number
  dailyPercent: number
  monthlyPercent: number
  limits: { DAILY_USD: number; MONTHLY_USD: number }
  exchangeRates: Record<string, number>
  selectedCurrency: Currency
  fetchUsage: () => Promise<void>
  fetchExchangeRates: () => Promise<void>
  cycleCurrency: () => void
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  daily: 0,
  monthly: 0,
  dailyPercent: 0,
  monthlyPercent: 0,
  limits: { DAILY_USD: 5, MONTHLY_USD: 20 },
  exchangeRates: { JPY: 150, EUR: 0.92, CNY: 7.25, GBP: 0.79 },
  selectedCurrency: 'USD',

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

  fetchExchangeRates: async () => {
    try {
      const res = await fetch('/api/exchange-rates')
      if (res.ok) {
        const rates = await res.json()
        set({ exchangeRates: rates })
      }
    } catch {
      // フォールバックレートを維持
    }
  },

  cycleCurrency: () => {
    const current = get().selectedCurrency
    const idx = CURRENCY_ORDER.indexOf(current)
    const next = CURRENCY_ORDER[(idx + 1) % CURRENCY_ORDER.length]
    set({ selectedCurrency: next })
  },
}))
