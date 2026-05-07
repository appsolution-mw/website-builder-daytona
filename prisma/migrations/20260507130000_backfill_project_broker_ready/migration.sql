-- Backfill RUNNING projects that pre-date the brokerReady flag. Such
-- projects were already serving traffic before the readiness signal existed,
-- so they are by definition broker-ready; only newly-spawned sandboxes need
-- to wait for the worker-agent callback.
UPDATE "Project"
SET "brokerReady" = true,
    "brokerReadyAt" = COALESCE("brokerReadyAt", NOW())
WHERE status = 'RUNNING'
  AND "brokerReady" = false;
