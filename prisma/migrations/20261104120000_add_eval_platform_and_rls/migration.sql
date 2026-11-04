-- Add the evaluation platform to the existing, migrated chat database.
-- Before applying to an existing deployment, audit its schema and
-- _prisma_migrations history. A database previously changed with `db push`
-- may already contain incompatible objects and needs a separately reviewed
-- baseline/reconciliation. Do not hide that mismatch with IF NOT EXISTS.
--
-- Historical chat tables, enums, UsageLog.modelRunId and its foreign key are
-- intentionally retained, even though they are absent from schema.prisma.
-- Future generated migrations must not remove them without a data migration.
-- Only the old modelRunId NOT NULL constraint is relaxed so evaluation usage
-- can be recorded without manufacturing a legacy ModelRun.
--
-- PostgreSQL does not automatically wrap a Prisma migration in a transaction.
-- Keep creation, compatibility changes and RLS activation atomic.
BEGIN;

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PromptSource" AS ENUM ('GENERATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('ACCURACY', 'RELEVANCE', 'CONCISENESS', 'TONE', 'INSTRUCTION', 'EDGE_CASE', 'GENERAL');

-- CreateEnum
CREATE TYPE "EvalRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SCORING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('COMPLETED', 'FAILED', 'TIMEOUT', 'REFUSED');

-- CreateTable
CREATE TABLE "EvalProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "useCaseProfile" JSONB,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvalProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptSet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "PromptSource" NOT NULL,
    "generationConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptItem" (
    "id" TEXT NOT NULL,
    "promptSetId" TEXT NOT NULL,
    "category" "PromptCategory" NOT NULL,
    "prompt" TEXT NOT NULL,
    "evaluationFocus" TEXT NOT NULL,
    "goldStandardHint" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "promptSetId" TEXT NOT NULL,
    "targetModels" TEXT[],
    "judgeModel" TEXT NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'PENDING',
    "estimatedCostUsd" DECIMAL(10,8),
    "actualCostUsd" DECIMAL(10,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelResponse" (
    "id" TEXT NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "promptItemId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "model" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(10,8),
    "latencyMs" INTEGER,
    "status" "ResponseStatus" NOT NULL DEFAULT 'COMPLETED',
    "piiMasked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeScore" (
    "id" TEXT NOT NULL,
    "modelResponseId" TEXT NOT NULL,
    "judgeModel" TEXT NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "relevance" INTEGER NOT NULL,
    "conciseness" INTEGER NOT NULL,
    "tone" INTEGER NOT NULL,
    "instructionFollowing" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalReport" (
    "id" TEXT NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "rankings" JSONB NOT NULL,
    "scoreMatrix" JSONB NOT NULL,
    "highlights" JSONB NOT NULL,
    "costProjection" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalReport_pkey" PRIMARY KEY ("id")
);

-- Retain the old usage relationship and all old rows; add the new optional one.
ALTER TABLE "UsageLog"
    ALTER COLUMN "modelRunId" DROP NOT NULL,
    ADD COLUMN "modelResponseId" TEXT;

-- CreateIndex
CREATE INDEX "EvalProject_userId_isArchived_idx" ON "EvalProject"("userId", "isArchived");
CREATE INDEX "PromptSet_projectId_idx" ON "PromptSet"("projectId");
CREATE INDEX "PromptItem_promptSetId_idx" ON "PromptItem"("promptSetId");
CREATE INDEX "EvalRun_projectId_idx" ON "EvalRun"("projectId");
CREATE INDEX "ModelResponse_evalRunId_idx" ON "ModelResponse"("evalRunId");
CREATE INDEX "ModelResponse_promptItemId_idx" ON "ModelResponse"("promptItemId");
CREATE UNIQUE INDEX "JudgeScore_modelResponseId_key" ON "JudgeScore"("modelResponseId");
CREATE UNIQUE INDEX "EvalReport_evalRunId_key" ON "EvalReport"("evalRunId");

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_modelResponseId_fkey" FOREIGN KEY ("modelResponseId") REFERENCES "ModelResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromptSet" ADD CONSTRAINT "PromptSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "EvalProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptItem" ADD CONSTRAINT "PromptItem_promptSetId_fkey" FOREIGN KEY ("promptSetId") REFERENCES "PromptSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "EvalProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalRun" ADD CONSTRAINT "EvalRun_promptSetId_fkey" FOREIGN KEY ("promptSetId") REFERENCES "PromptSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModelResponse" ADD CONSTRAINT "ModelResponse_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelResponse" ADD CONSTRAINT "ModelResponse_promptItemId_fkey" FOREIGN KEY ("promptItemId") REFERENCES "PromptItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_modelResponseId_fkey" FOREIGN KEY ("modelResponseId") REFERENCES "ModelResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalReport" ADD CONSTRAINT "EvalReport_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Match the existing server-only access model: no direct-client policies.
-- With RLS enabled and no policies, nonowner anon/authenticated roles cannot
-- SELECT/INSERT/UPDATE/DELETE, even if they have ordinary table grants.
-- The trusted server table owner bypasses RLS and must enforce user scope.
ALTER TABLE "EvalProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvalRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModelResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JudgeScore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvalReport" ENABLE ROW LEVEL SECURITY;

COMMIT;
