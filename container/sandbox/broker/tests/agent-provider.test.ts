import { afterEach, describe, expect, it } from "vitest";
import { agentRuntimeFromEnv } from "../src/agent-provider";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("agentRuntimeFromEnv", () => {
  it.each(["openhands", "open-hands", "openhands-sdk"])(
    "maps %s to the OpenHands runtime",
    (runtime) => {
      process.env.AGENT_RUNTIME = runtime;
      delete process.env.AGENT_PROVIDER;

      expect(agentRuntimeFromEnv()).toBe("openhands");
    },
  );
});
