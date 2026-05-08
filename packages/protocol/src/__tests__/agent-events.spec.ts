import { describe, it, expectTypeOf } from "vitest";
import type { BrokerToHost } from "../index";

type Session = Extract<BrokerToHost, { type: "agent.session" }>;
type Done = Extract<BrokerToHost, { type: "agent.done" }>;
type Violation = Extract<BrokerToHost, { type: "agent.policy_violation" }>;

describe("protocol additions for Agent SDK", () => {
  it("agent.session has optional resumed: boolean", () => {
    expectTypeOf<Session>().toHaveProperty("resumed").toEqualTypeOf<boolean | undefined>();
  });

  it("agent.done has optional subtype, agent.session does not", () => {
    expectTypeOf<Done>().toHaveProperty("subtype");
    expectTypeOf<Session>().not.toHaveProperty("subtype");
  });

  it("agent.policy_violation has the expected shape", () => {
    expectTypeOf<Violation>().toHaveProperty("turnId").toEqualTypeOf<string>();
    expectTypeOf<Violation>().toHaveProperty("tool").toEqualTypeOf<string>();
    expectTypeOf<Violation>().toHaveProperty("reason").toEqualTypeOf<string>();
    expectTypeOf<Violation>().toHaveProperty("redactedInput").toEqualTypeOf<string>();
    expectTypeOf<Violation>().toHaveProperty("agentId").toEqualTypeOf<string | undefined>();
  });
});
