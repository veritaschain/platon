import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/db/client'
import { decrypt } from '@/lib/crypto/encryption'
import OpenAI from 'openai'

const FALLBACK_RATES: Record<string, number> = {
  JPY: 150,
  EUR: 0.92,
  CNY: 7.25,
  GBP: 0.79,
}

let cachedRates: Record<string, number> | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

export async function GET() {
  // Return cached if fresh
  if (cachedRates && Date.now() - cacheTimestamp < CACHE_TTL) {
    return NextResponse.json(cachedRates)
  }

  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(FALLBACK_RATES)
    }

    // Try to get Grok (XAI) API key
    const keyRecord = await prisma.userApiKey.findFirst({
      where: { userId: user.id, provider: 'XAI', isActive: true },
    })

    if (!keyRecord) {
      cachedRates = FALLBACK_RATES
      cacheTimestamp = Date.now()
      return NextResponse.json(FALLBACK_RATES)
    }

    const apiKey = decrypt(keyRecord.encryptedKey)
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    })

    const completion = await client.chat.completions.create({
      model: 'grok-3',
      messages: [
        {
          role: 'user',
          content: 'USD/JPY, USD/EUR, USD/CNY, USD/GBP の現在の為替レートを JSON で返してください。キーは通貨コード(JPY, EUR, CNY, GBP)、値は1USDに対するレートの数値のみ。説明不要、JSONのみ出力してください。例: {"JPY": 150.5, "EUR": 0.92, "CNY": 7.25, "GBP": 0.79}',
        },
      ],
      max_tokens: 200,
      temperature: 0,
    })

    const text = completion.choices[0]?.message?.content ?? ''
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      // Validate structure
      const rates: Record<string, number> = {}
      for (const key of ['JPY', 'EUR', 'CNY', 'GBP']) {
        const val = Number(parsed[key])
        rates[key] = isFinite(val) && val > 0 ? val : FALLBACK_RATES[key]
      }
      cachedRates = rates
      cacheTimestamp = Date.now()
      return NextResponse.json(rates)
    }

    // Parse failed, use fallback
    cachedRates = FALLBACK_RATES
    cacheTimestamp = Date.now()
    return NextResponse.json(FALLBACK_RATES)
  } catch {
    cachedRates = FALLBACK_RATES
    cacheTimestamp = Date.now()
    return NextResponse.json(FALLBACK_RATES)
  }
}
