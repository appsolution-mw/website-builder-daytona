-- CreateEnum
CREATE TYPE "TokenUsageLabel" AS ENUM ('CODER', 'REVIEWER', 'TURN');

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "label" "TokenUsageLabel" NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "webSearchRequests" INTEGER NOT NULL DEFAULT 0,
    "webFetchRequests" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(18,9) NOT NULL DEFAULT 0,
    "exitCode" INTEGER NOT NULL DEFAULT 0,
    "serviceTier" TEXT,
    "inferenceGeo" TEXT,
    "rawUsage" JSONB,
    "modelUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenUsage_projectId_turnId_label_key" ON "TokenUsage"("projectId", "turnId", "label");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_createdAt_idx" ON "TokenUsage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_turnId_idx" ON "TokenUsage"("projectId", "turnId");

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
