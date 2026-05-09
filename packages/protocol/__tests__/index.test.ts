import { describe, expect, it } from "vitest";
import type { BrokerToHost } from "../src";
import { PROTOCOL_VERSION } from "../src";

describe("git events", () => {
  it("PROTOCOL_VERSION is bumped to 1.15.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.15.0");
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
