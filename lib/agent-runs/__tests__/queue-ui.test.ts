import { describe, expect, it } from "vitest";

import { blockedRunActionState } from "../queue-ui";

describe("blockedRunActionState", () => {
  it("enables unblock actions only when a run blocks the project queue", () => {
    expect(blockedRunActionState({
      state: "BLOCKED",
      activeRunId: null,
      blockedRunId: "run-1",
      blockedAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    })).toEqual({ blockedRunId: "run-1", canUnblock: true });

    expect(blockedRunActionState({
      state: "RUNNING",
      activeRunId: "run-2",
      blockedRunId: null,
      blockedAt: null,
      updatedAt: "2026-05-07T00:00:00.000Z",
    })).toEqual({ blockedRunId: null, canUnblock: false });
  });
});
