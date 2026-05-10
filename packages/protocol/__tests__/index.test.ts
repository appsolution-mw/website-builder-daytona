import { describe, expect, it } from "vitest";
import type { BrokerToHost } from "../src";
import { PROTOCOL_VERSION } from "../src";

describe("git events", () => {
  it("PROTOCOL_VERSION is bumped to 1.17.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.17.0");
  });

  it("BrokerToHost accepts git.commit USER shape", () => {
    const evt: BrokerToHost = {
      type: "git.commit",
      turnId: null,
      sha: "0".repeat(40),
      shortSha: "0000000",
      title: "Edit foo.tsx",
      bodyMessage: "foo.tsx | +1 -0\n\nAuthor: u@example.com",
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
      runtime: null,
      modelId: null,
      authorKind: "USER",
      committedAt: new Date().toISOString(),
    };
    expect(evt.type).toBe("git.commit");
  });

  it("BrokerToHost accepts git.commit ROLLBACK shape", () => {
    const evt: BrokerToHost = {
      type: "git.commit",
      turnId: null,
      sha: "0".repeat(40),
      shortSha: "0000000",
      title: "Revert to 1234567 — old",
      bodyMessage: "Reverted-from: …",
      filesChanged: 1,
      insertions: 0,
      deletions: 3,
      runtime: null,
      modelId: null,
      authorKind: "ROLLBACK",
      revertedFromSha: "1".repeat(40),
      committedAt: new Date().toISOString(),
    };
    expect(evt.type).toBe("git.commit");
  });

  it("BrokerToHost accepts git.commit shape", () => {
    const evt: BrokerToHost = {
      type: "git.commit",
      turnId: "run_1",
      sha: "0".repeat(40),
      shortSha: "0000000",
      title: "hello",
      bodyMessage: "body",
      filesChanged: 1,
      insertions: 2,
      deletions: 3,
      runtime: "claude-code",
      modelId: null,
      authorKind: "AGENT",
      committedAt: new Date().toISOString(),
    };
    expect(evt.type).toBe("git.commit");
  });

  it("BrokerToHost accepts git.commit.skipped shape", () => {
    const evt: BrokerToHost = {
      type: "git.commit.skipped",
      turnId: "run_1",
      reason: "no_changes",
    };
    expect(evt.type).toBe("git.commit.skipped");
  });
});
