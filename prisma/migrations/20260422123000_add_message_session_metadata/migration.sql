ALTER TABLE "Message" ADD COLUMN "turnId" TEXT;
ALTER TABLE "Message" ADD COLUMN "agentId" TEXT;

CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
