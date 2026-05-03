import type { Runtime } from "../types";
import { createCloudClient } from "./cloud";

export type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

function lazyRuntime(load: () => Promise<Runtime>): Runtime {
  let runtimePromise: Promise<Runtime> | null = null;
  const runtime = () => {
    runtimePromise ??= load();
    return runtimePromise;
  };
  return {
    async spawnProjectSandbox(args) {
      return (await runtime()).spawnProjectSandbox(args);
    },
    async destroyProjectSandbox(sandboxId) {
      return (await runtime()).destroyProjectSandbox(sandboxId);
    },
    async getSandboxStatus(sandboxId) {
      return (await runtime()).getSandboxStatus(sandboxId);
    },
  };
}

/** Returns the Daytona-backed Runtime. If `explicitMode` is provided it wins; otherwise `DAYTONA_MODE` env var is read. */
export function createDaytonaRuntime(explicitMode?: "cloud" | "fake"): Runtime {
  const mode = explicitMode ?? process.env.DAYTONA_MODE ?? "cloud";
  switch (mode) {
    case "fake":
      return lazyRuntime(async () => {
        const { createFakeClient } = await import(/* turbopackIgnore: true */ "./fake");
        return createFakeClient();
      });
    case "cloud":
      return createCloudClient();
    default:
      throw new Error(`Unknown DAYTONA_MODE: ${mode}`);
  }
}

/** @deprecated Use `createDaytonaRuntime()`. Kept for backward-compat. */
export const createDaytonaClient = createDaytonaRuntime;
