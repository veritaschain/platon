'use client'

import { useParams, useRouter } from 'next/navigation'
import { ModelSelector } from '@/components/eval/ModelSelector'

export default function ModelsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const handleStart = (runId: string) => {
    router.push(`/${projectId}/run`)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-bold mb-6">対象モデル選択</h1>
        <ModelSelector projectId={projectId} onStartEval={handleStart} />
      </div>
    </div>
  )
}
