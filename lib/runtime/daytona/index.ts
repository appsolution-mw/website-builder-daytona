import type { Runtime } from "../types";
import { createCloudClient } from "./cloud";
import { createFakeClient } from "./fake";

export type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

/** Returns the Daytona-backed Runtime selected by `DAYTONA_MODE`. */
export function createDaytonaRuntime(): Runtime {
  const mode = process.env.DAYTONA_MODE ?? "cloud";
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
