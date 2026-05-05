import { createDaytonaRuntime } from "./daytona";
import {
  createHetznerWorkerPoolRuntime,
  createLocalWorkerPoolRuntime,
} from "./worker-pool";
import type { Runtime } from "./types";

export { createDaytonaRuntime };
export {
  createHetznerWorkerPoolRuntime,
  createLocalWorkerPoolRuntime,
} from "./worker-pool";

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
 *   daytona-cloud      — real Daytona API
 *   daytona-fake       — in-process local broker
 *   worker-pool-local  — WorkerPoolRuntime against a locally running worker-agent (H.1b)
 *   worker-pool-hetzner — WorkerPoolRuntime against managed Hetzner workers
 */
export function createRuntime(): Runtime {
  const explicit = process.env.RUNTIME_MODE;
  const mode = explicit ?? `daytona-${process.env.DAYTONA_MODE ?? "cloud"}`;

  if (mode === "daytona-cloud" || mode === "daytona-fake") {
    const daytonaMode = mode === "daytona-cloud" ? "cloud" : "fake";
    return explicit ? createDaytonaRuntime(daytonaMode) : createDaytonaRuntime();
  }
  if (mode === "worker-pool-local") {
    return createLocalWorkerPoolRuntime();
  }
  if (mode === "worker-pool-hetzner") {
    return createHetznerWorkerPoolRuntime();
  }
  // Old reserved names from H.1a — keep throwing helpful errors
  if (mode === "hetzner-fake" || mode === "hetzner-cloud") {
    throw new Error(
      `RUNTIME_MODE='${mode}' was renamed in H.1b. Use 'worker-pool-local' (now) or 'worker-pool-hetzner' (H.1c+).`,
    );
  }
  throw new Error(`Unknown RUNTIME_MODE: ${mode}`);
}
