import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { encrypt } from '@/lib/crypto/encryption'
import { createClient } from '@/lib/supabase/server'
import type { Provider } from '@/lib/connectors/types'

export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const keys = await prisma.userApiKey.findMany({
      where: { userId: user.id },
      select: { id: true, provider: true, keyHint: true, isActive: true, createdAt: true },
    })
    return NextResponse.json(keys)
  } catch (e) {
    console.error('[GET /api/connectors/keys]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { provider, apiKey } = await req.json()
    if (!provider || !apiKey) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const encryptedKey = encrypt(apiKey)
    const keyHint = '...' + apiKey.slice(-4)

    const existing = await prisma.userApiKey.findFirst({ where: { userId: user.id, provider } })
    if (existing) {
      await prisma.userApiKey.update({
        where: { id: existing.id },
        data: { encryptedKey, keyHint, isActive: true },
      })
    } else {
      await prisma.userApiKey.create({
        data: { userId: user.id, provider: provider as Provider, encryptedKey, keyHint },
      })
    }

    return NextResponse.json({ success: true, keyHint })
  } catch (e) {
    console.error('[POST /api/connectors/keys]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
