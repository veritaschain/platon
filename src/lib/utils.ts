import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null || usd < 0.001) return '<$0.001'
  return `$${usd.toFixed(4)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}

export function getProviderColor(provider: string): string {
  switch (provider) {
    case 'OPENAI': return 'text-green-600'
    case 'ANTHROPIC': return 'text-orange-600'
    case 'GOOGLE': return 'text-blue-600'
    case 'XAI': return 'text-red-600'
    default: return 'text-gray-600'
  }
}

export function getProviderBg(provider: string): string {
  switch (provider) {
    case 'OPENAI': return 'bg-green-50 border-green-200'
    case 'ANTHROPIC': return 'bg-orange-50 border-orange-200'
    case 'GOOGLE': return 'bg-blue-50 border-blue-200'
    case 'XAI': return 'bg-red-50 border-red-200'
    default: return 'bg-gray-50 border-gray-200'
  }
}

export function getModelLabel(model: string): string {
  const labels: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o mini',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'grok-3': 'Grok-3',
  }
  return labels[model] ?? model
}
