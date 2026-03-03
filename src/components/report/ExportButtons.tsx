'use client'

import { useState } from 'react'
import { useReportStore } from '@/stores/report-store'
import { Button } from '@/components/common/Button'

interface ExportButtonsProps {
  projectId: string
  runId: string
}

export function ExportButtons({ projectId, runId }: ExportButtonsProps) {
  const { exportReport } = useReportStore()
  const [exporting, setExporting] = useState<string | null>(null)

  const handleExport = async (format: 'pdf' | 'md') => {
    setExporting(format)
    try {
      await exportReport(projectId, runId, format)
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport('md')}
        disabled={exporting !== null}
      >
        {exporting === 'md' ? '...' : 'Markdown'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport('pdf')}
        disabled={exporting !== null}
      >
        {exporting === 'pdf' ? '...' : 'PDF'}
      </Button>
    </div>
  )
}
