import type { Runtime, SandboxInfo, SandboxStatus } from "../types";

/**
 * Backward-compat alias. Daytona's runtime conforms to the unified `Runtime`
 * interface — they have the same three methods and the same arg shapes.
 *
 * Existing call sites importing `DaytonaClient` keep working until we touch them.
 */
export type DaytonaClient = Runtime;

export type { SandboxInfo, SandboxStatus };
