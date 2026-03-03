import { prisma } from '@/lib/db/client'
import { getConnector } from '@/lib/connectors/registry'
import { getUserApiKey } from '@/lib/db/api-keys'
import { SUPPORTED_MODELS } from '@/lib/connectors/types'
import type { ConnectorConfig, ConnectorMessage, Provider } from '@/lib/connectors/types'
import type { JudgeScoreResult } from './types'
import type { UseCaseProfile } from './types'

interface JudgeParams {
  evalRunId: string
  userId: string
  judgeModel: string
  useCaseProfile: UseCaseProfile | null
  responses: {
    modelResponseId: string
    prompt: string
    goldStandardHint: string | null
    content: string
  }[]
}

export async function judgeAllResponses(params: JudgeParams): Promise<void> {
  const { evalRunId, userId, judgeModel, useCaseProfile, responses } = params

  // Resolve judge model → provider
  const judgeInfo = SUPPORTED_MODELS.find(m => m.model === judgeModel)
  if (!judgeInfo) throw new Error(`Unknown judge model: ${judgeModel}`)

  const apiKey = await getUserApiKey(userId, judgeInfo.provider as Provider)
  if (!apiKey) throw new Error(`APIキーが見つかりません: ${judgeInfo.provider}`)

  const connector = getConnector(judgeInfo.provider as Provider)
  const config: ConnectorConfig = {
    provider: judgeInfo.provider as Provider,
    model: judgeModel,
    apiKey,
    maxTokens: 1024,
    temperature: 0,
    timeoutMs: 30000,
  }

  // Judge each response
  for (const resp of responses) {
    if (!resp.content) continue // Skip failed responses

    const scoreResult = await judgeWithRetry(connector, config, {
      useCaseDescription: useCaseProfile
        ? `${useCaseProfile.domain} - ${useCaseProfile.audience}`
        : '一般的なAI利用',
      goldStandardHint: resp.goldStandardHint || '特になし',
      prompt: resp.prompt,
      response: resp.content,
    })

    if (scoreResult) {
      await prisma.judgeScore.create({
        data: {
          modelResponseId: resp.modelResponseId,
          judgeModel,
          accuracy: scoreResult.accuracy.score,
          relevance: scoreResult.relevance.score,
          conciseness: scoreResult.conciseness.score,
          tone: scoreResult.tone.score,
          instructionFollowing: scoreResult.instruction_following.score,
          reasons: {
            accuracy: scoreResult.accuracy.reason,
            relevance: scoreResult.relevance.reason,
            conciseness: scoreResult.conciseness.reason,
            tone: scoreResult.tone.reason,
            instruction_following: scoreResult.instruction_following.reason,
          },
        },
      })
    }
  }
}

async function judgeWithRetry(
  connector: { send: Function },
  config: ConnectorConfig,
  input: {
    useCaseDescription: string
    goldStandardHint: string
    prompt: string
    response: string
  },
  attempt = 0
): Promise<JudgeScoreResult | null> {
  const messages: ConnectorMessage[] = [
    {
      role: 'user',
      content: `あなたはAI回答の品質評価者です。
以下のユーザー質問とAIの回答を評価してください。

## ユーザーのユースケース
${input.useCaseDescription}

## 理想的な回答の方向性
${input.goldStandardHint}

## 評価対象の質問
${input.prompt}

## AIの回答
${input.response}

以下の5軸で1-5点で採点し、JSON形式のみで出力してください。

{
  "accuracy": { "score": 1-5, "reason": "1文で根拠" },
  "relevance": { "score": 1-5, "reason": "..." },
  "conciseness": { "score": 1-5, "reason": "..." },
  "tone": { "score": 1-5, "reason": "..." },
  "instruction_following": { "score": 1-5, "reason": "..." }
}`,
    },
  ]

  try {
    const response = await connector.send(messages, config)
    const parsed = parseJudgeResponse(response.content)
    if (parsed) return parsed

    // Parse failed, retry once
    if (attempt === 0) {
      return judgeWithRetry(connector, config, input, 1)
    }
    return null
  } catch {
    if (attempt === 0) {
      return judgeWithRetry(connector, config, input, 1)
    }
    return null
  }
}

function parseJudgeResponse(raw: string): JudgeScoreResult | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim()
    const parsed = JSON.parse(cleaned)

    // Validate structure
    const axes = ['accuracy', 'relevance', 'conciseness', 'tone', 'instruction_following']
    for (const axis of axes) {
      if (!parsed[axis] || typeof parsed[axis].score !== 'number') return null
      // Clamp score to 1-5
      parsed[axis].score = Math.max(1, Math.min(5, Math.round(parsed[axis].score)))
      parsed[axis].reason = parsed[axis].reason || ''
    }

    return parsed as JudgeScoreResult
  } catch {
    return null
  }
}
