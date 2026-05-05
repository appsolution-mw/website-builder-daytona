ALTER TABLE "Project" RENAME COLUMN "daytonaSandboxId" TO "sandboxId";

ALTER TYPE "SandboxLifecycleStatus" ADD VALUE IF NOT EXISTS 'STOPPED';

ALTER TABLE "Project" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "Project_publicSlug_key" ON "Project"("publicSlug");

ALTER TABLE "Worker" ADD COLUMN "name" TEXT;
UPDATE "Worker"
SET "name" = COALESCE(NULLIF("tailscaleHostname", ''), 'Worker ' || "id")
WHERE "name" IS NULL;
ALTER TABLE "Worker" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Worker" ADD COLUMN "serverType" TEXT;
ALTER TABLE "Worker" ADD COLUMN "provisioningError" TEXT;
ALTER TABLE "Worker" ADD COLUMN "readyAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "WorkerSandbox_projectId_key";

CREATE UNIQUE INDEX "WorkerSandbox_active_projectId_key"
ON "WorkerSandbox"("projectId")
WHERE "status" <> 'DESTROYED';
