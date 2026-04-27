import type { Runtime } from "../types";
import { createCloudClient } from "./cloud";
import { createFakeClient } from "./fake";

export type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

/** Returns the Daytona-backed Runtime. If `explicitMode` is provided it wins; otherwise `DAYTONA_MODE` env var is read. */
export function createDaytonaRuntime(explicitMode?: "cloud" | "fake"): Runtime {
  const mode = explicitMode ?? process.env.DAYTONA_MODE ?? "cloud";
  switch (mode) {
    case "fake":
      return createFakeClient();
    case "cloud":
      return createCloudClient();
    default:
      throw new Error(`Unknown DAYTONA_MODE: ${mode}`);
  }
}

/** @deprecated Use `createDaytonaRuntime()`. Kept for backward-compat. */
export const createDaytonaClient = createDaytonaRuntime;
