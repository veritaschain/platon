'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Badge } from '@/components/common/Badge'
import { formatCost } from '@/lib/utils'
import Link from 'next/link'

type Provider = 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'XAI'

interface ApiKey { id: string; provider: Provider; keyHint: string }

interface TestResult { provider: Provider; valid: boolean; message: string }

const PROVIDER_INFO: Record<Provider, { name: string; icon: string; color: string }> = {
  OPENAI: { name: 'OpenAI', icon: '🟢', color: 'text-green-600' },
  ANTHROPIC: { name: 'Anthropic', icon: '🟠', color: 'text-orange-600' },
  GOOGLE: { name: 'Google', icon: '🔵', color: 'text-blue-600' },
  XAI: { name: 'xAI', icon: '🔴', color: 'text-red-600' },
}

export default function SettingsPage() {
  const [addingProvider, setAddingProvider] = useState<Provider | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [error, setError] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [testingProvider, setTestingProvider] = useState<Provider | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const queryClient = useQueryClient()

  const { data: connectorData } = useQuery({
    queryKey: ['connectors-keys'],
    queryFn: async () => {
      const res = await fetch('/api/connectors/keys')
      if (!res.ok) return []
      return res.json() as Promise<ApiKey[]>
    },
  })

  const { data: usageData } = useQuery({
    queryKey: ['usage'],
    queryFn: async () => {
      const res = await fetch('/api/usage')
      if (!res.ok) return null
      return res.json()
    },
  })

  const { data: limitsData } = useQuery({
    queryKey: ['usage-limits'],
    queryFn: async () => {
      const res = await fetch('/api/usage/limits')
      if (!res.ok) return null
      return res.json()
    },
  })

  const addKey = useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: Provider; apiKey: string }) => {
      const res = await fetch('/api/connectors/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      })
      if (!res.ok) {
        const text = await res.text()
        let err: { error?: string }
        try { err = JSON.parse(text) } catch { err = { error: text || 'サーバーエラーが発生しました' } }
        throw new Error(err.error ?? 'Failed to add key')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors-keys'] })
      setAddingProvider(null)
      setApiKeyInput('')
      setError('')
    },
    onError: (err) => setError(err.message),
  })

  const removeKey = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/connectors/keys/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connectors-keys'] }),
  })

  const testSavedKey = async (provider: Provider) => {
    setTestingProvider(provider)
    setTestResults(prev => ({ ...prev, [provider]: undefined as any }))
    try {
      const res = await fetch('/api/connectors/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, testSaved: true }),
      })
      const data = await res.json()
      setTestResults(prev => ({ ...prev, [provider]: { provider, valid: data.valid, message: data.message } }))
    } catch {
      setTestResults(prev => ({ ...prev, [provider]: { provider, valid: false, message: '通信エラー' } }))
    } finally {
      setTestingProvider(null)
    }
  }

  const testAllKeys = async () => {
    setTestingAll(true)
    setTestResults({})
    const providers = apiKeys.map(k => k.provider)
    await Promise.all(providers.map(p => testSavedKey(p)))
    setTestingAll(false)
  }

  const apiKeys = Array.isArray(connectorData) ? connectorData : []
  const configuredProviders = new Set(apiKeys.map((k) => k.provider))

  return (
    <div className="min-h-screen bg-background overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
            ← チャットに戻る
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">APIキーとコスト設定を管理します</p>
        </div>

        {/* API Keys */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">APIキー（BYOK）</h2>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              各プロバイダーのAPIキーを登録します。キーはAES-256-GCMで暗号化して保存されます。
            </p>
            {apiKeys.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={testAllKeys}
                disabled={testingAll}
              >
                {testingAll ? 'テスト中...' : '全キーをテスト'}
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {(['OPENAI', 'ANTHROPIC', 'GOOGLE', 'XAI'] as Provider[]).map((provider) => {
              const info = PROVIDER_INFO[provider]
              const key = apiKeys.find((k) => k.provider === provider)
              const isConfigured = configuredProviders.has(provider)
              const isAdding = addingProvider === provider

              return (
                <div
                  key={provider}
                  className="border border-border rounded-lg p-4 bg-card"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{info.icon}</span>
                      <div>
                        <p className="font-medium text-sm text-foreground">{info.name}</p>
                        {key && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            キー: {key.keyHint}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isConfigured ? 'success' : 'secondary'}>
                        {isConfigured ? '設定済み' : '未設定'}
                      </Badge>
                      {isConfigured && key ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => testSavedKey(provider)}
                            disabled={testingProvider === provider}
                          >
                            {testingProvider === provider ? 'テスト中...' : '接続テスト'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setAddingProvider(provider); setApiKeyInput(''); setError(''); setTestResults(prev => { const n = { ...prev }; delete n[provider]; return n }) }}
                          >
                            更新
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { removeKey.mutate(key.id); setTestResults(prev => { const n = { ...prev }; delete n[provider]; return n }) }}
                          >
                            削除
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddingProvider(provider)}
                        >
                          追加
                        </Button>
                      )}
                    </div>
                  </div>

                  {isAdding && (
                    <div className="mt-3 flex gap-2">
                      <Input
                        type="text"
                        value={apiKeyInput}
                        onChange={(e) => { setApiKeyInput(e.target.value); setError('') }}
                        placeholder={`${info.name} APIキーを入力...`}
                        className="flex-1"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                        autoFocus
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => addKey.mutate({ provider, apiKey: apiKeyInput })}
                        disabled={!apiKeyInput.trim() || addKey.isPending}
                      >
                        {addKey.isPending ? '保存中...' : '保存'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => { setAddingProvider(null); setApiKeyInput(''); setError('') }}
                      >
                        キャンセル
                      </Button>
                    </div>
                  )}
                  {isAdding && error && (
                    <p className="mt-2 text-xs text-red-500">{error}</p>
                  )}
                  {testResults[provider] && (
                    <div className={`mt-2 text-xs px-3 py-2 rounded border ${
                      testResults[provider].valid
                        ? 'text-green-700 bg-green-50 border-green-200'
                        : 'text-red-600 bg-red-50 border-red-200'
                    }`}>
                      {testResults[provider].valid ? '✓ ' : '✗ '}
                      {testResults[provider].message}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Usage */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">今月の利用状況</h2>

          <div className="border border-border rounded-lg p-4 bg-card space-y-4">
            {limitsData && (
              <>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">日次コスト</span>
                    <span className="font-medium">
                      {formatCost(limitsData.dailyUsd)} / $5.00
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min((limitsData.dailyUsd / 5) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">月次コスト</span>
                    <span className="font-medium">
                      {formatCost(limitsData.monthlyUsd)} / $20.00
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min((limitsData.monthlyUsd / 20) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                {limitsData.isBlocked && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                    コスト上限に達しました。新しい月になるとリセットされます。
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
