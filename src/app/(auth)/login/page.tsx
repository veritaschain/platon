'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/common/Button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()

  const handleAuth = async () => {
    setLoading(true)
    setError('')
    const supabase = createClient()
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMessage('確認メールを送信しました')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🧠</div>
          <h1 className="font-bold text-xl text-gray-900">Platon AI</h1>
          <p className="text-sm text-gray-500 mt-1">複数AIの思考を統合するエンジン</p>
        </div>

        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="メールアドレス"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="パスワード"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          {message && <p className="text-green-600 text-xs">{message}</p>}
          <Button onClick={handleAuth} disabled={loading} className="w-full">
            {loading ? '処理中...' : isSignUp ? 'アカウント作成' : 'ログイン'}
          </Button>
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-xs text-gray-500 hover:text-gray-700"
          >
            {isSignUp ? 'ログインはこちら' : 'アカウントを作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
