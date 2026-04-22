-- Persist the Claude Code session UUID separately from the app chat session id.
ALTER TABLE "Session" ADD COLUMN "claudeSessionId" TEXT;

WITH numbered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "Session"
)
UPDATE "Session"
SET "claudeSessionId" = '00000000-0000-4000-8000-' || lpad(numbered.rn::text, 12, '0')
FROM numbered
WHERE "Session"."id" = numbered."id";

ALTER TABLE "Session" ALTER COLUMN "claudeSessionId" SET NOT NULL;

CREATE UNIQUE INDEX "Session_claudeSessionId_key" ON "Session"("claudeSessionId");
