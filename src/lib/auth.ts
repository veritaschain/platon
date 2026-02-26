/**
 * Server-side auth helper
 */
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const ANONYMOUS_USER_ID = 'anonymous-user'

export async function getAuthenticatedUser(req?: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      // 認証無効化中: 仮ユーザーを返す
      return { user: { id: ANONYMOUS_USER_ID } as any, error: null }
    }

    return { user, error: null }
  } catch {
    return { user: { id: ANONYMOUS_USER_ID } as any, error: null }
  }
}

/**
 * API ルートで使う: Supabase 認証またはフォールバック
 */
export async function getUserId(): Promise<string> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? ANONYMOUS_USER_ID
  } catch {
    return ANONYMOUS_USER_ID
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function badRequestResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function serverErrorResponse(message = 'Internal server error') {
  return NextResponse.json({ error: message }, { status: 500 })
}
