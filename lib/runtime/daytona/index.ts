import type { DaytonaClient } from "./types";
import { createCloudClient } from "./cloud";
import { createFakeClient } from "./fake";

export type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

export function createDaytonaClient(): DaytonaClient {
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
