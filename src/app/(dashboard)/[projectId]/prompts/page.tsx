'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePromptSetStore } from '@/stores/prompt-set-store'
import { PromptSetEditor } from '@/components/prompt-editor/PromptSetEditor'
import { Button } from '@/components/common/Button'

export default function PromptsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const { promptSet, isLoading, fetchPromptSet } = usePromptSetStore()

  useEffect(() => {
    fetchPromptSet(projectId)
  }, [projectId])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!promptSet) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground mb-4">プロンプトセットがまだありません</p>
        <Button onClick={() => router.push(`/${projectId}/onboarding`)}>
          ヒアリングを開始
        </Button>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">プロンプトセット</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {promptSet.promptItems.length}問 ({promptSet.source === 'GENERATED' ? '自動生成' : 'インポート'})
            </p>
          </div>
          <Button onClick={() => router.push(`/${projectId}/models`)}>
            モデル選択へ →
          </Button>
        </div>

        <PromptSetEditor projectId={projectId} />
      </div>
    </div>
  )
}
