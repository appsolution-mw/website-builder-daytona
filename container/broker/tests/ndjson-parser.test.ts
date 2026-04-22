import { describe, it, expect } from "vitest";
import { parseNdjsonLine } from "../src/ndjson-parser";
import type { BrokerToHost } from "@wbd/protocol";

const TURN = "t-123";

describe("parseNdjsonLine", () => {
  it("maps init system event to agent.status{phase:starting}", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "s-1" });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual<BrokerToHost[]>([
      { type: "agent.status", turnId: TURN, phase: "starting" },
    ]);
  });

  it("maps assistant text content to agent.chunk", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual<BrokerToHost[]>([
      { type: "agent.chunk", turnId: TURN, delta: "Hello world" },
    ]);
  });

  it("maps assistant tool_use to agent.tool_use + agent.status{tool_use}", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/workspace/project/app/page.tsx" } },
        ],
      },
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.tool_use",
        turnId: TURN,
        tool: "Edit",
        input: { file_path: "/workspace/project/app/page.tsx" },
      },
      {
        type: "agent.status",
        turnId: TURN,
        phase: "tool_use",
        detail: "Edit",
      },
    ]);
  });

  it("maps assistant with multiple content blocks in order", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Editing now:" },
          { type: "tool_use", name: "Write", input: { path: "a.txt" } },
        ],
      },
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events.map((e) => e.type)).toEqual(["agent.chunk", "agent.tool_use", "agent.status"]);
  });

  it("swallows user tool_result events (returns empty)", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual([]);
  });

  it("maps result success to agent.done with all fields", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      duration_ms: 12340,
      num_turns: 3,
      total_cost_usd: 0.012,
      usage: { input_tokens: 1234, output_tokens: 456 },
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.done",
        turnId: TURN,
        durationMs: 12340,
        tokensIn: 1234,
        tokensOut: 456,
        costUsd: 0.012,
        exitCode: 0,
      },
    ]);
  });

  it("maps result non-success to agent.error", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      duration_ms: 5000,
    });
    const events = parseNdjsonLine(line, TURN);
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.error",
        turnId: TURN,
        message: "claude terminated with subtype: error_max_turns",
      },
    ]);
  });

  it("returns [] for blank or whitespace lines", () => {
    expect(parseNdjsonLine("", TURN)).toEqual([]);
    expect(parseNdjsonLine("   ", TURN)).toEqual([]);
  });

  it("returns [] (does not throw) for malformed JSON", () => {
    expect(parseNdjsonLine("{not valid json", TURN)).toEqual([]);
  });

  it("returns [] for unknown type (forward-compatible)", () => {
    const line = JSON.stringify({ type: "future_event_type", foo: "bar" });
    expect(parseNdjsonLine(line, TURN)).toEqual([]);
  });

  it("handles the recorded fixture end-to-end", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const content = await readFile(resolve(here, "fixtures/sample-turn.ndjson"), "utf8");
    const lines = content.split("\n");
    const allEvents: BrokerToHost[] = [];
    for (const line of lines) {
      allEvents.push(...parseNdjsonLine(line, TURN));
    }
    expect(allEvents.length).toBeGreaterThan(0);
    // The last real event should be agent.done or agent.error
    const last = allEvents[allEvents.length - 1];
    expect(["agent.done", "agent.error"]).toContain(last?.type);
  });
});
