'use client'

import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { useEvalStore } from '@/stores/eval-store'
import { useReportStore } from '@/stores/report-store'
import { RankingCard } from '@/components/report/RankingCard'
import { ScoreMatrix } from '@/components/report/ScoreMatrix'
import { RadarChart } from '@/components/report/RadarChart'
import { ResponseComparison } from '@/components/report/ResponseComparison'
import { CostProjection } from '@/components/report/CostProjection'
import { RecommendationCard } from '@/components/report/RecommendationCard'
import { ExportButtons } from '@/components/report/ExportButtons'

export default function ReportPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { evalRuns, fetchEvalRuns } = useEvalStore()
  const { report, isLoading, fetchReport } = useReportStore()

  useEffect(() => {
    fetchEvalRuns(projectId)
  }, [projectId])

  useEffect(() => {
    const completedRun = evalRuns.find(r => r.status === 'COMPLETED')
    if (completedRun) {
      fetchReport(projectId, completedRun.id)
    }
  }, [evalRuns])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-muted-foreground">レポートがまだありません</p>
      </div>
    )
  }

  const completedRun = evalRuns.find(r => r.status === 'COMPLETED')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">評価レポート</h1>
          {completedRun && (
            <ExportButtons projectId={projectId} runId={completedRun.id} />
          )}
        </div>

        {/* Section 1: Rankings */}
        <RankingCard rankings={report.rankings} />

        {/* Section 2: Score Matrix */}
        <ScoreMatrix scoreMatrix={report.scoreMatrix} />

        {/* Section 3: Radar Chart */}
        <RadarChart rankings={report.rankings} />

        {/* Section 4: Response Comparison */}
        <ResponseComparison highlights={report.highlights} />

        {/* Section 5: Cost Projection */}
        <CostProjection costProjection={report.costProjection} />

        {/* Section 6: Recommendation */}
        <RecommendationCard recommendation={report.recommendation} />
      </div>
    </div>
  )
}
