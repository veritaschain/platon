import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { encrypt } from '@/lib/crypto/encryption'
import { getUserId } from '@/lib/auth'
import type { Provider } from '@/lib/connectors/types'

export async function GET() {
  try {
    const userId = await getUserId()

    const keys = await prisma.userApiKey.findMany({
      where: { userId },
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
    const userId = await getUserId()

    const { provider, apiKey } = await req.json()
    if (!provider || !apiKey) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const encryptedKey = encrypt(apiKey)
    const keyHint = '...' + apiKey.slice(-4)

    const existing = await prisma.userApiKey.findFirst({ where: { userId, provider } })
    if (existing) {
      await prisma.userApiKey.update({
        where: { id: existing.id },
        data: { encryptedKey, keyHint, isActive: true },
      })
    } else {
      await prisma.userApiKey.create({
        data: { userId, provider: provider as Provider, encryptedKey, keyHint },
      })
    }

    return NextResponse.json({ success: true, keyHint })
  } catch (e) {
    console.error('[POST /api/connectors/keys]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
