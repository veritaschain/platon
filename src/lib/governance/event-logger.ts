import { prisma } from '@/lib/db/client'
import crypto from 'crypto'

export type EventType =
  | 'user_message'
  | 'model_run'
  | 'handoff'
  | 'integrate'
  | 'cost'
  | 'pii_mask'
  | 'provider_block'
  | 'image_attachment'
  | 'eval_run_event'
  | 'model_response_event'
  | 'judge_event'
  | 'project_event'

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

export async function logEvent(
  userId: string,
  sessionId: string,
  eventType: EventType,
  payload: object,
  content?: string
) {
  const enrichedPayload = content
    ? { ...payload, contentHash: hashContent(content) }
    : payload

  await prisma.eventLog.create({
    data: { userId, sessionId, eventType, payload: enrichedPayload },
  }).catch(console.error)
}
