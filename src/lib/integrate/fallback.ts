import type { ConnectorMessage } from '@/lib/connectors/types'

export function buildFallbackPrompt(
  responses: { modelName: string; content: string }[]
): ConnectorMessage[] {
  const responsesText = responses.map(r =>
    `## ${r.modelName}の回答\n${r.content}`
  ).join('\n\n')

  return [{
    role: 'user',
    content: `以下は同じ質問に対する複数AIの回答です。

${responsesText}

以下の形式で統合してください：
1. **共通見解**: 全AIが一致した点
2. **相違点**: AIによって異なる点
3. **統合結論**: 総合的な結論
4. **信頼度評価**: 高/中/低とその理由`,
  }]
}
