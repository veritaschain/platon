'use client'

import { useParams, useRouter } from 'next/navigation'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export default function OnboardingPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const handleComplete = () => {
    router.push(`/${projectId}/prompts`)
  }

  const handleImport = () => {
    router.push(`/${projectId}/prompts`)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <OnboardingWizard
          projectId={projectId}
          onComplete={handleComplete}
          onImport={handleImport}
        />
      </div>
    </div>
  )
}
