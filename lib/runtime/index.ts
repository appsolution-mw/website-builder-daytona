import {
  createHetznerWorkerPoolRuntime,
  createLocalWorkerPoolRuntime,
} from "./worker-pool";
import type { Runtime } from "./types";

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
 * Returns the runtime selected by `RUNTIME_MODE`.
 *
 * Supported modes:
 *   worker-pool-local   — WorkerPoolRuntime against a locally running worker-agent
 *   worker-pool-hetzner — WorkerPoolRuntime against managed Hetzner workers
 */
export function createRuntime(): Runtime {
  const mode = process.env.RUNTIME_MODE;

  if (mode === "worker-pool-local") {
    return createLocalWorkerPoolRuntime();
  }
  if (mode === "worker-pool-hetzner") {
    return createHetznerWorkerPoolRuntime();
  }
  if (!mode) {
    throw new Error(
      "RUNTIME_MODE is not set. Use 'worker-pool-local' or 'worker-pool-hetzner'.",
    );
  }
  throw new Error(`Unknown RUNTIME_MODE: ${mode}`);
}
