import type { TrustStructure, Conflict } from './types'
import type { ConnectorMessage } from '@/lib/connectors/types'

export function buildSynthesisPrompt(
  trust: TrustStructure,
  conflicts: Conflict[],
  stanceDistribution: string
): { prompt: string; messages: ConnectorMessage[] } {
  const highTrustText = trust.highTrust.slice(0, 5).map(c =>
    `- ${c.content}（重み: ${c.compositeWeight.toFixed(2)}）`
  ).join('\n') || '（なし）'

  const conditionalText = trust.conditional.slice(0, 5).map(c =>
    `- ${c.content}（重み: ${c.compositeWeight.toFixed(2)}）`
  ).join('\n') || '（なし）'

  const uncertainText = trust.uncertain.slice(0, 5).map(c =>
    `- ${c.content}（重み: ${c.compositeWeight.toFixed(2)}）`
  ).join('\n') || '（なし）'

  const conflictsText = conflicts.map(c =>
    `- [${c.type}] ${c.description}（関係モデル: ${c.sources.join(', ')}）`
  ).join('\n') || '（なし）'

  const prompt = `あなたは複数AIの回答を統合する分析者です。
以下の構造化データに基づいて統合結論を生成してください。

## 信頼構造
高信頼（全AI一致）:
${highTrustText}

条件付き（一部一致）:
${conditionalText}

不確実（対立あり）:
${uncertainText}

## コンフリクト
${conflictsText}

## 立場分布
${stanceDistribution}

---

以下の形式で統合結論を生成してください：

1. **統合結論**（300字以内）: 信頼構造を反映した最終結論
2. **高信頼の要素**: 全AIが一致した点（そのまま採用してよい）
3. **条件付きの要素**: 採用する場合の条件を明示
4. **未解決の対立**: 追加情報なしには判断できない点
5. **推奨アクション**: ユーザーが次に取るべき行動（1-3個）`

  return { prompt, messages: [{ role: 'user', content: prompt }] }
}
