'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Sparkles, TrendingUp, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { IntegrateResult } from '@/stores/message-store'

interface WeightedClaim {
  content: string
  compositeWeight: number
  modelName: string
  scores?: {
    consistency: number
    specificity: number
    evidenceStrength: number
    counterResistance: number
  }
}
interface TrustStructure {
  highTrust: WeightedClaim[]
  conditional: WeightedClaim[]
  uncertain: WeightedClaim[]
}
interface Conflict {
  type: string
  description: string
  sources: string[]
}

interface IntegrateCardProps {
  result: IntegrateResult
}

export function IntegrateCard({ result }: IntegrateCardProps) {
  const [showEvidence, setShowEvidence] = useState(false)
  const trust = result.step15TrustStructure as unknown as TrustStructure
  const conflicts = result.step15Conflicts as unknown as Conflict[]
  const totalClaims = (trust.highTrust?.length ?? 0) + (trust.conditional?.length ?? 0) + (trust.uncertain?.length ?? 0)
  const highPct = totalClaims > 0 ? ((trust.highTrust?.length ?? 0) / totalClaims) * 100 : 0
  const condPct = totalClaims > 0 ? ((trust.conditional?.length ?? 0) / totalClaims) * 100 : 0
  const uncPct = totalClaims > 0 ? ((trust.uncertain?.length ?? 0) / totalClaims) * 100 : 0

  return (
    <div className="rounded-xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={18} className="text-purple-600" />
        <span className="font-bold text-purple-800">統合結論</span>
        {result.fallbackUsed && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
            簡易モード
          </span>
        )}
      </div>

      {/* Trust Structure Bar */}
      {!result.fallbackUsed && totalClaims > 0 && (
        <div className="mb-4">
          <div className="flex text-xs text-gray-500 mb-1 justify-between">
            <span>信頼構造</span>
            <span>{trust.highTrust?.length ?? 0}高 / {trust.conditional?.length ?? 0}条件付き / {trust.uncertain?.length ?? 0}不確実</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden">
            {highPct > 0 && <div className="bg-green-500" style={{ width: `${highPct}%` }} />}
            {condPct > 0 && <div className="bg-yellow-400" style={{ width: `${condPct}%` }} />}
            {uncPct > 0 && <div className="bg-red-400" style={{ width: `${uncPct}%` }} />}
          </div>
          <div className="flex gap-3 mt-1 text-xs">
            <span className="text-green-600">■ 高信頼</span>
            <span className="text-yellow-600">■ 条件付き</span>
            <span className="text-red-500">■ 不確実</span>
          </div>
        </div>
      )}

      {/* Claims summary */}
      {!result.fallbackUsed && (trust.highTrust?.length ?? 0) > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 text-xs font-medium text-green-700 mb-1">
            <TrendingUp size={12} />共通見解
          </div>
          <ul className="text-sm text-gray-700 space-y-1">
            {trust.highTrust.slice(0, 3).map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-green-500 shrink-0">✓</span>
                <span>{c.content}</span>
                <span className="text-xs text-gray-400 shrink-0">({c.modelName})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!result.fallbackUsed && (conflicts?.length ?? 0) > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 text-xs font-medium text-orange-700 mb-1">
            <AlertTriangle size={12} />対立点
          </div>
          <ul className="text-sm text-gray-600 space-y-1">
            {conflicts.slice(0, 2).map((c, i) => (
              <li key={i} className="text-orange-700 text-xs">
                {c.description}
                <span className="text-gray-400 ml-1">({c.sources.join(', ')})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Evidence trace toggle */}
      {!result.fallbackUsed && totalClaims > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
          >
            {showEvidence ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            エビデンストレース ({totalClaims}件)
          </button>
          {showEvidence && (
            <div className="mt-2 space-y-2 border-l-2 border-purple-200 pl-3">
              {[
                { label: '高信頼', claims: trust.highTrust ?? [], color: 'text-green-700' },
                { label: '条件付き', claims: trust.conditional ?? [], color: 'text-yellow-700' },
                { label: '不確実', claims: trust.uncertain ?? [], color: 'text-red-600' },
              ].map(({ label, claims, color }) =>
                claims.length > 0 && (
                  <div key={label}>
                    <div className={`text-xs font-medium ${color} mb-1`}>{label}</div>
                    {claims.map((c, i) => (
                      <div key={i} className="text-xs text-gray-600 mb-1 pl-2">
                        <span className="font-medium">{c.modelName}</span>: {c.content}
                        {c.scores && (
                          <span className="text-gray-400 ml-1">
                            (一致:{(c.scores.consistency * 100).toFixed(0)}% 証拠:{(c.scores.evidenceStrength * 100).toFixed(0)}% 重み:{c.compositeWeight.toFixed(2)})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* Main output */}
      <div className="mt-3 pt-3 border-t border-purple-200">
        <div className="prose prose-sm max-w-none text-gray-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {result.step2Output}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
