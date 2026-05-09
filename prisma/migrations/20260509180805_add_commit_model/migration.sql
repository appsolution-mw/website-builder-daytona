-- CreateEnum
CREATE TYPE "CommitAuthorKind" AS ENUM ('AGENT', 'USER');

-- CreateTable
CREATE TABLE "Commit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT,
    "agentRunId" TEXT,
    "sha" TEXT NOT NULL,
    "shortSha" TEXT NOT NULL,
    "authorKind" "CommitAuthorKind" NOT NULL,
    "runtime" "AgentRuntime",
    "modelId" TEXT,
    "title" TEXT NOT NULL,
    "bodyMessage" TEXT NOT NULL,
    "filesChanged" INTEGER NOT NULL,
    "insertions" INTEGER NOT NULL,
    "deletions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Commit_agentRunId_key" ON "Commit"("agentRunId");

-- CreateIndex
CREATE INDEX "Commit_projectId_createdAt_idx" ON "Commit"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Commit_sessionId_createdAt_idx" ON "Commit"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commit" ADD CONSTRAINT "Commit_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
