import { prisma } from '@/lib/db/client'

export interface EvaluationScope {
  evalRunId: string
  projectId: string
  userId: string
  promptSetId?: string
}

export type BoundEvaluationScope = EvaluationScope & { promptSetId: string }

export class EvaluationScopeError extends Error {
  readonly code = 'EVALUATION_SCOPE_LOST'
  constructor() { super('Evaluation is no longer available to this user') }
}

export function runWhere(scope: EvaluationScope) {
  if ([scope.evalRunId, scope.projectId, scope.userId].some(value => typeof value !== 'string' || !value) ||
      (scope.promptSetId !== undefined && (typeof scope.promptSetId !== 'string' || !scope.promptSetId))) throw new EvaluationScopeError()
  return {
    id: scope.evalRunId,
    projectId: scope.projectId,
    project: { userId: scope.userId },
    promptSet: { projectId: scope.projectId, project: { userId: scope.userId } },
    ...(scope.promptSetId !== undefined && { promptSetId: scope.promptSetId }),
  }
}

export function promptWhere(scope: BoundEvaluationScope) {
  runWhere(scope)
  if (!scope.promptSetId) throw new EvaluationScopeError()
  return {
    promptSetId: scope.promptSetId,
    promptSet: { projectId: scope.projectId, project: { userId: scope.userId } },
  }
}

export function responseWhere(scope: BoundEvaluationScope) {
  return { evalRunId: scope.evalRunId, evalRun: runWhere(scope), promptItem: promptWhere(scope) }
}

// A fresh database check at a dispatch boundary; it is not a lease over an
// external provider request. Nested connect predicates also guard persistence.
export async function assertEvaluationScope(scope: EvaluationScope) {
  try {
    return await prisma.evalRun.findUniqueOrThrow({
      where: runWhere(scope),
      select: { id: true, promptSetId: true, targetModels: true, judgeModel: true },
    })
  } catch (error) {
    if (isEvaluationScopeError(error)) throw new EvaluationScopeError()
    throw error
  }
}

export function isEvaluationScopeError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ['EVALUATION_SCOPE_LOST', 'P2025', 'P2018'].includes(String(error.code))
}
