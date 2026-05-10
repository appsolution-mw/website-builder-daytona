-- Drop the VERCEL_AI value from the AgentRuntime enum (T-20260510-001).
--
-- Strategy: Postgres has no DROP VALUE for enums, so we
--   1. fold any rows still referencing VERCEL_AI onto a safe replacement
--      (CLAUDE_CODE for required columns, NULL for nullable ones),
--   2. rename the existing enum aside, create a fresh one without VERCEL_AI,
--   3. retype every column to the new enum and drop the old type.

-- 1. Fold existing data
UPDATE "Project"             SET "agentRuntime"   = 'CLAUDE_CODE' WHERE "agentRuntime"::text   = 'VERCEL_AI';
UPDATE "Project"             SET "desiredRuntime" = 'CLAUDE_CODE' WHERE "desiredRuntime"::text = 'VERCEL_AI';
UPDATE "AgentRun"            SET "runtime"        = 'CLAUDE_CODE' WHERE "runtime"::text        = 'VERCEL_AI';
UPDATE "Commit"              SET "runtime"        = NULL          WHERE "runtime"::text        = 'VERCEL_AI';
UPDATE "Session"             SET "defaultRuntime" = 'CLAUDE_CODE' WHERE "defaultRuntime"::text = 'VERCEL_AI';
UPDATE "Message"             SET "runtime"        = NULL          WHERE "runtime"::text        = 'VERCEL_AI';
UPDATE "TokenUsage"          SET "runtime"        = NULL          WHERE "runtime"::text        = 'VERCEL_AI';
-- SessionRuntimeState.runtime is part of the (sessionId, runtime) unique key,
-- so we cannot collapse VERCEL_AI rows onto CLAUDE_CODE without risking a
-- unique violation. Drop the rows instead — they are disposable runtime state.
DELETE FROM "SessionRuntimeState" WHERE "runtime"::text = 'VERCEL_AI';

-- 2. Swap enum types
ALTER TYPE "AgentRuntime" RENAME TO "AgentRuntime_old";
CREATE TYPE "AgentRuntime" AS ENUM ('CLAUDE_CODE', 'OPENAI_CODEX', 'OPENHANDS');

-- 3. Retype every column referencing the enum
ALTER TABLE "Project"
  ALTER COLUMN "agentRuntime"   DROP DEFAULT,
  ALTER COLUMN "agentRuntime"   TYPE "AgentRuntime" USING "agentRuntime"::text::"AgentRuntime",
  ALTER COLUMN "agentRuntime"   SET DEFAULT 'CLAUDE_CODE',
  ALTER COLUMN "desiredRuntime" DROP DEFAULT,
  ALTER COLUMN "desiredRuntime" TYPE "AgentRuntime" USING "desiredRuntime"::text::"AgentRuntime",
  ALTER COLUMN "desiredRuntime" SET DEFAULT 'CLAUDE_CODE';

ALTER TABLE "AgentRun"
  ALTER COLUMN "runtime" TYPE "AgentRuntime" USING "runtime"::text::"AgentRuntime";

ALTER TABLE "Commit"
  ALTER COLUMN "runtime" TYPE "AgentRuntime" USING "runtime"::text::"AgentRuntime";

ALTER TABLE "Session"
  ALTER COLUMN "defaultRuntime" DROP DEFAULT,
  ALTER COLUMN "defaultRuntime" TYPE "AgentRuntime" USING "defaultRuntime"::text::"AgentRuntime",
  ALTER COLUMN "defaultRuntime" SET DEFAULT 'CLAUDE_CODE';

ALTER TABLE "Message"
  ALTER COLUMN "runtime" TYPE "AgentRuntime" USING "runtime"::text::"AgentRuntime";

ALTER TABLE "TokenUsage"
  ALTER COLUMN "runtime" TYPE "AgentRuntime" USING "runtime"::text::"AgentRuntime";

ALTER TABLE "SessionRuntimeState"
  ALTER COLUMN "runtime" TYPE "AgentRuntime" USING "runtime"::text::"AgentRuntime";

DROP TYPE "AgentRuntime_old";
