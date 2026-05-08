import { describe, it, expectTypeOf } from "vitest";
import type { BrokerToHost } from "../index";

describe("protocol additions for Agent SDK", () => {
  it("agent.session accepts optional resumed flag", () => {
    const evt: BrokerToHost = {
      type: "agent.session",
      turnId: "t1",
      runtime: "claude-code",
      providerSessionId: "sess-1",
      resumed: true,
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });

  it("agent.done accepts optional subtype", () => {
    const evt: BrokerToHost = {
      type: "agent.done",
      turnId: "t1",
      durationMs: 1234,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      exitCode: 0,
      subtype: "success",
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });

  it("agent.policy_violation event exists", () => {
    const evt: BrokerToHost = {
      type: "agent.policy_violation",
      turnId: "t1",
      tool: "Bash",
      reason: "Destructive pattern blocked",
      redactedInput: "rm -rf /",
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });
});
