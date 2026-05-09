import { describe, expect, it } from "vitest";
import type { BrokerToHost } from "@wbd/protocol";
import { runEventTypeForBrokerEvent } from "../executor-client";

describe("runEventTypeForBrokerEvent", () => {
  it("maps agent.policy_violation to POLICY_VIOLATION", () => {
    const event: BrokerToHost = {
      type: "agent.policy_violation",
      turnId: "t1",
      tool: "Bash",
      reason: "blocked",
      redactedInput: "rm -rf /",
    };
    expect(runEventTypeForBrokerEvent(event)).toBe("POLICY_VIOLATION");
  });

  it("maps agent.session to STATUS", () => {
    const event: BrokerToHost = {
      type: "agent.session",
      turnId: "t1",
      runtime: "claude-code",
      providerSessionId: "s1",
      resumed: false,
    };
    expect(runEventTypeForBrokerEvent(event)).toBe("STATUS");
  });

  it("maps agent.chunk to CHUNK", () => {
    const event: BrokerToHost = {
      type: "agent.chunk",
      turnId: "t1",
      delta: "hello",
    };
    expect(runEventTypeForBrokerEvent(event)).toBe("CHUNK");
  });

  it("returns null for unknown types", () => {
    const event = { type: "agent.something_unknown" } as unknown as BrokerToHost;
    expect(runEventTypeForBrokerEvent(event)).toBeNull();
  });
});
