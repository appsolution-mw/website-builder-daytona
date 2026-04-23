-- CreateEnum
CREATE TYPE "AgentRuntime" AS ENUM ('CLAUDE_CODE', 'OPENAI_CODEX', 'VERCEL_AI');

-- CreateEnum
CREATE TYPE "RuntimeSwitchStatus" AS ENUM ('IDLE', 'PENDING', 'SWITCHING', 'FAILED');

-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "agentRuntime" "AgentRuntime" NOT NULL DEFAULT 'CLAUDE_CODE',
ADD COLUMN "desiredRuntime" "AgentRuntime" NOT NULL DEFAULT 'CLAUDE_CODE',
ADD COLUMN "runtimeGeneration" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "runtimeSwitchStatus" "RuntimeSwitchStatus" NOT NULL DEFAULT 'IDLE';

-- AlterTable
ALTER TABLE "Session"
ADD COLUMN "defaultRuntime" "AgentRuntime" NOT NULL DEFAULT 'CLAUDE_CODE';

-- AlterTable
ALTER TABLE "Message"
ADD COLUMN "modelId" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "runtime" "AgentRuntime";

-- AlterTable
ALTER TABLE "TokenUsage"
ADD COLUMN "modelId" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "runtime" "AgentRuntime";

-- CreateTable
CREATE TABLE "SessionRuntimeState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "runtime" "AgentRuntime" NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "modelId" TEXT,
    "resumeState" JSONB,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRuntimeState_pkey" PRIMARY KEY ("id")
);

-- Backfill existing Claude session ids into runtime state records.
INSERT INTO "SessionRuntimeState" (
    "id",
    "projectId",
    "sessionId",
    "runtime",
    "providerSessionId",
    "lastUsedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'srs_' || md5("Session"."id" || ':CLAUDE_CODE'),
    "Session"."projectId",
    "Session"."id",
    'CLAUDE_CODE'::"AgentRuntime",
    "Session"."claudeSessionId",
    "Session"."lastMessageAt",
    "Session"."createdAt",
    CURRENT_TIMESTAMP
FROM "Session";

-- CreateIndex
CREATE UNIQUE INDEX "SessionRuntimeState_sessionId_runtime_key"
ON "SessionRuntimeState"("sessionId", "runtime");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRuntimeState_runtime_providerSessionId_key"
ON "SessionRuntimeState"("runtime", "providerSessionId");

-- CreateIndex
CREATE INDEX "SessionRuntimeState_projectId_sessionId_idx"
ON "SessionRuntimeState"("projectId", "sessionId");

-- AddForeignKey
ALTER TABLE "SessionRuntimeState"
ADD CONSTRAINT "SessionRuntimeState_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRuntimeState"
ADD CONSTRAINT "SessionRuntimeState_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "Session_claudeSessionId_key";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "claudeSessionId";
