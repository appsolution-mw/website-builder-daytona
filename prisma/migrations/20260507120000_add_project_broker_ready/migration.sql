-- Add explicit broker readiness flag so the UI can wait for the sandbox broker
-- to finish booting instead of trusting `status = RUNNING` alone.
ALTER TABLE "Project"
  ADD COLUMN "brokerReady" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "brokerReadyAt" TIMESTAMP(3);
