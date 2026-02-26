import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { decrypt } from '@/lib/crypto/encryption'
import { createClient } from '@/lib/supabase/server'
import type { Provider } from '@/lib/connectors/types'

export async function POST(req: Request) {
  const { provider, apiKey, testSaved } = await req.json()

  // 保存済みキーのテスト
  if (testSaved) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const keyRecord = await prisma.userApiKey.findFirst({
      where: { userId: user.id, provider: provider as Provider, isActive: true },
    })
    if (!keyRecord) {
      return NextResponse.json({ valid: false, message: 'APIキーが登録されていません' })
    }

    try {
      const decryptedKey = decrypt(keyRecord.encryptedKey)
      const connector = getConnector(provider as Provider)
      const valid = await connector.validateApiKey(decryptedKey)
      return NextResponse.json({
        valid,
        message: valid ? '接続成功' : 'APIキーが無効です。新しいキーを登録してください。',
      })
    } catch (err: any) {
      return NextResponse.json({
        valid: false,
        message: err?.message?.includes('401') || err?.message?.includes('authentication')
          ? 'APIキーが無効または期限切れです'
          : `接続エラー: ${err?.message ?? '不明なエラー'}`,
      })
    }
  }

  // 新規キーのテスト（保存前チェック）
  if (!provider || !apiKey) {
    return NextResponse.json({ valid: false, message: 'provider と apiKey が必要です' })
  }

  try {
    const connector = getConnector(provider as Provider)
    const valid = await connector.validateApiKey(apiKey)
    return NextResponse.json({
      valid,
      message: valid ? '接続成功' : 'APIキーが無効です',
    })
  } catch (err: any) {
    return NextResponse.json({
      valid: false,
      message: `接続エラー: ${err?.message ?? '不明なエラー'}`,
    })
  }
}
