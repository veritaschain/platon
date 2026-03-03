'use client'

import { useState, useRef } from 'react'
import { usePromptSetStore } from '@/stores/prompt-set-store'
import { Button } from '@/components/common/Button'
import { QuestionCard } from './QuestionCard'
import { cn } from '@/lib/utils'

interface OnboardingWizardProps {
  projectId: string
  onComplete: () => void
  onImport: () => void
}

interface Question {
  id: string
  question: string
  type: 'single' | 'multi' | 'text' | 'mixed'
  options?: string[]
  required: boolean
}

const QUESTIONS: Question[] = [
  {
    id: 'q1_useCase',
    question: 'AIを何に使いたいですか？',
    type: 'single',
    options: ['カスタマーサポート', 'コード生成', '文書要約', '翻訳', 'データ分析', 'その他'],
    required: true,
  },
  {
    id: 'q2_audience',
    question: '対象ユーザーは？',
    type: 'single',
    options: ['社内チーム', '一般消費者', '専門家', 'その他'],
    required: true,
  },
  {
    id: 'q3_priorities',
    question: '回答に求める性格は？（複数選択可）',
    type: 'multi',
    options: ['正確さ重視', 'スピード重視', '丁寧さ重視', '創造性重視', '簡潔さ重視'],
    required: true,
  },
  {
    id: 'q4_domain',
    question: '業界・ドメインは？',
    type: 'mixed',
    options: ['EC・小売', '金融・保険', 'IT・ソフトウェア', '医療・ヘルスケア', '教育', '製造業'],
    required: false,
  },
  {
    id: 'q5_constraints',
    question: '絶対に外せないポイント、NGなことは？',
    type: 'text',
    required: false,
  },
]

export function OnboardingWizard({ projectId, onComplete, onImport }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const { isGenerating, generatePromptSet, importPromptSet } = usePromptSetStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentQ = QUESTIONS[currentStep]
  const isLastStep = currentStep === QUESTIONS.length - 1
  const progress = ((currentStep + 1) / QUESTIONS.length) * 100

  const handleAnswer = (value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [currentQ.id]: value }))
    setError(null)
  }

  const handleNext = async () => {
    // Validate required
    if (currentQ.required && !answers[currentQ.id]) {
      setError('この質問への回答は必須です')
      return
    }

    if (isLastStep) {
      await handleGenerate()
    } else {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handleSkip = () => {
    if (!isLastStep) setCurrentStep(prev => prev + 1)
  }

  const handleGenerate = async () => {
    try {
      setError(null)
      await generatePromptSet(projectId, {
        q1_useCase: (answers.q1_useCase as string) || '',
        q2_audience: (answers.q2_audience as string) || '',
        q3_priorities: (answers.q3_priorities as string[]) || [],
        q4_domain: (answers.q4_domain as string) || '',
        q5_constraints: (answers.q5_constraints as string) || '',
      })
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
    }
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await importPromptSet(projectId, file)
      onImport()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました')
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>ヒアリング</span>
          <span>{currentStep + 1} / {QUESTIONS.length}</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <QuestionCard
        question={currentQ.question}
        type={currentQ.type}
        options={currentQ.options}
        value={answers[currentQ.id]}
        onChange={handleAnswer}
      />

      {/* Error */}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {currentStep > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentStep(prev => prev - 1)}
            >
              ← 戻る
            </Button>
          )}
          {!currentQ.required && !isLastStep && (
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              スキップ
            </Button>
          )}
        </div>

        <Button
          onClick={handleNext}
          disabled={isGenerating}
          size="sm"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              生成中...
            </span>
          ) : isLastStep ? (
            'プロンプトを生成'
          ) : (
            '次へ →'
          )}
        </Button>
      </div>

      {/* Import option */}
      <div className="border-t border-border pt-4 mt-6">
        <p className="text-xs text-muted-foreground mb-2">
          または、自作のプロンプトセットをインポート:
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          onChange={handleFileImport}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          CSV / JSON をインポート
        </Button>
      </div>
    </div>
  )
}
