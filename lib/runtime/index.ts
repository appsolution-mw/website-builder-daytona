import { createDaytonaRuntime } from "./daytona";
import type { Runtime } from "./types";

export type {
  Runtime,
  SandboxInfo,
  SandboxStatus,
  SpawnArgs,
  Scheduler,
  WorkerProvisioner,
  WorkerRecord,
  WorkerStatus,
  PickWorkerArgs,
  ProvisionArgs,
} from "./types";

/**
 * Returns the runtime selected by `RUNTIME_MODE`. If unset, falls back to
 * `daytona-${DAYTONA_MODE ?? "cloud"}` so existing deployments keep working.
 *
 * Supported modes:
 *   daytona-cloud   — real Daytona API (existing)
 *   daytona-fake    — in-process local broker (existing)
 *   hetzner-fake    — multi-cloud runtime with FakeProvisioner (Phase H.1c+)
 *   hetzner-cloud   — multi-cloud runtime with HetznerProvisioner (Phase H.1c+)
 *
 * When `RUNTIME_MODE=daytona-*` is set explicitly, we override `DAYTONA_MODE`
 * so the legacy daytona factory picks the right backend without the user
 * needing to set both env vars.
 */
export function createRuntime(): Runtime {
  const explicit = process.env.RUNTIME_MODE;
  const mode = explicit ?? `daytona-${process.env.DAYTONA_MODE ?? "cloud"}`;

  if (mode === "daytona-cloud" || mode === "daytona-fake") {
    if (explicit) {
      process.env.DAYTONA_MODE = mode === "daytona-cloud" ? "cloud" : "fake";
    }
    return createDaytonaRuntime();
  }
  if (mode === "hetzner-fake" || mode === "hetzner-cloud") {
    throw new Error(
      `RUNTIME_MODE='${mode}' is reserved for Phase H.1c+; not implemented in H.1a`,
    );
  }
  throw new Error(`Unknown RUNTIME_MODE: ${mode}`);
}
