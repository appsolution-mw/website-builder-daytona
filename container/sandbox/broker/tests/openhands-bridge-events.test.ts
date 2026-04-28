import { describe, expect, it } from "vitest";
import type { BrokerToHost } from "@wbd/protocol";
import { parseOpenHandsBridgeLine } from "../src/openhands-bridge-events";

describe("parseOpenHandsBridgeLine", () => {
  it("maps bridge JSONL records to broker events", () => {
    const lines = [
      { type: "chunk", delta: "hello", agentId: "worker" },
      { type: "tool", tool: "Bash", input: { command: "ls" }, agentId: "worker" },
      { type: "status", phase: "thinking", detail: "planning", agentId: "worker" },
      {
        type: "done",
        durationMs: 25,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        usage: { provider: "openhands" },
      },
      { type: "error", message: "boom", agentId: "worker" },
    ];

    const events = lines.map((line) => parseOpenHandsBridgeLine(JSON.stringify(line), "turn-1"));

    expect(events).toEqual<BrokerToHost[]>([
      { type: "agent.chunk", turnId: "turn-1", delta: "hello", agentId: "worker" },
      {
        type: "agent.tool_use",
        turnId: "turn-1",
        tool: "Bash",
        input: { command: "ls" },
        agentId: "worker",
      },
      {
        type: "agent.status",
        turnId: "turn-1",
        phase: "thinking",
        detail: "planning",
        agentId: "worker",
      },
      {
        type: "agent.done",
        turnId: "turn-1",
        durationMs: 25,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        exitCode: 0,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 15,
          webSearchRequests: 0,
          webFetchRequests: 0,
          rawUsage: { provider: "openhands" },
          modelUsage: { provider: "openhands" },
        },
      },
      { type: "agent.error", turnId: "turn-1", message: "boom", agentId: "worker" },
    ]);
  });

  it("ignores invalid JSON and unknown phases", () => {
    expect(parseOpenHandsBridgeLine("{broken", "turn-1")).toBeNull();
    expect(
      parseOpenHandsBridgeLine(JSON.stringify({ type: "status", phase: "reviewing" }), "turn-1"),
    ).toBeNull();
  });
});
