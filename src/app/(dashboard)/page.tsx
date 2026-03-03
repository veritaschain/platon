'use client'

import { useProjectStore } from '@/stores/project-store'
import { Button } from '@/components/common/Button'
import { useRouter } from 'next/navigation'
import { useSidebarContext } from './dashboard-shell'

export default function DashboardPage() {
  const { activeProjectId, createProject } = useProjectStore()
  const router = useRouter()
  const { openSidebar } = useSidebarContext()

  const handleNewProject = async () => {
    const project = await createProject('新規プロジェクト')
    if (project?.id) router.push(`/${project.id}/onboarding`)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      {/* Mobile menu button */}
      <button
        onClick={openSidebar}
        className="fixed top-3 left-3 p-2 rounded-md hover:bg-accent md:hidden z-10"
      >
        ☰
      </button>

      <div className="max-w-lg space-y-6">
        <h1 className="text-2xl font-bold text-foreground">
          Platon AI Eval
        </h1>
        <p className="text-muted-foreground">
          あなたのタスクで、どのAIが一番使えるかを定量的に答えるツール
        </p>

        <div className="space-y-3">
          <Button onClick={handleNewProject} size="lg" className="w-full max-w-xs">
            + 新規プロジェクトを作成
          </Button>
          <p className="text-xs text-muted-foreground">
            またはサイドバーから既存プロジェクトを選択
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 text-left">
          <div className="p-4 rounded-lg border border-border">
            <div className="text-lg mb-1">1</div>
            <h3 className="font-medium text-sm mb-1">ヒアリング</h3>
            <p className="text-xs text-muted-foreground">5つの質問に答えるだけ</p>
          </div>
          <div className="p-4 rounded-lg border border-border">
            <div className="text-lg mb-1">2</div>
            <h3 className="font-medium text-sm mb-1">一括評価</h3>
            <p className="text-xs text-muted-foreground">複数モデルを同時テスト</p>
          </div>
          <div className="p-4 rounded-lg border border-border">
            <div className="text-lg mb-1">3</div>
            <h3 className="font-medium text-sm mb-1">レポート</h3>
            <p className="text-xs text-muted-foreground">構造化された比較結果</p>
          </div>
        </div>
      </div>
    </div>
  )
}
