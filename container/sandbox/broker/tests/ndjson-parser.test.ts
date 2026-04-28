import { describe, it, expect } from "vitest";
import { parseNdjsonLine, createTaskMap, type TaskMap } from "../src/ndjson-parser";
import type { BrokerToHost } from "@wbd/protocol";

const TURN = "t-123";

describe("parseNdjsonLine", () => {
  it("maps init system event to agent.status{phase:starting}", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "11111111-1111-4111-8111-111111111111",
    });
    const events = parseNdjsonLine(line, TURN, createTaskMap());
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.session",
        turnId: TURN,
        runtime: "claude-code",
        providerSessionId: "11111111-1111-4111-8111-111111111111",
      },
      { type: "agent.status", turnId: TURN, phase: "starting" },
    ]);
  });

  it("maps assistant text content to agent.chunk", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    const events = parseNdjsonLine(line, TURN, createTaskMap());
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
    const events = parseNdjsonLine(line, TURN, createTaskMap());
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
    const events = parseNdjsonLine(line, TURN, createTaskMap());
    expect(events.map((e) => e.type)).toEqual(["agent.chunk", "agent.tool_use", "agent.status"]);
  });

  it("swallows user tool_result events (returns empty)", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
    });
    const events = parseNdjsonLine(line, TURN, createTaskMap());
    expect(events).toEqual([]);
  });

  it("maps result success to agent.done with all fields", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "22222222-2222-4222-8222-222222222222",
      duration_ms: 12340,
      num_turns: 3,
      total_cost_usd: 0.012,
      usage: {
        input_tokens: 1234,
        output_tokens: 456,
        cache_creation_input_tokens: 7,
        cache_read_input_tokens: 8,
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
        service_tier: "standard",
        inference_geo: "not_available",
      },
      modelUsage: { "claude-sonnet": { inputTokens: 1234 } },
    });
    const events = parseNdjsonLine(line, TURN, createTaskMap());
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.session",
        turnId: TURN,
        runtime: "claude-code",
        providerSessionId: "22222222-2222-4222-8222-222222222222",
      },
      {
        type: "agent.done",
        turnId: TURN,
        durationMs: 12340,
        tokensIn: 1234,
        tokensOut: 456,
        costUsd: 0.012,
        exitCode: 0,
        usage: {
          inputTokens: 1234,
          outputTokens: 456,
          cacheCreationInputTokens: 7,
          cacheReadInputTokens: 8,
          totalTokens: 1705,
          webSearchRequests: 1,
          webFetchRequests: 2,
          rawUsage: {
            input_tokens: 1234,
            output_tokens: 456,
            cache_creation_input_tokens: 7,
            cache_read_input_tokens: 8,
            server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
            service_tier: "standard",
            inference_geo: "not_available",
          },
          modelUsage: { "claude-sonnet": { inputTokens: 1234 } },
          serviceTier: "standard",
          inferenceGeo: "not_available",
        },
      },
    ]);
  });

  it("maps result non-success to agent.error", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      duration_ms: 5000,
    });
    const events = parseNdjsonLine(line, TURN, createTaskMap());
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.error",
        turnId: TURN,
        message: "claude terminated with subtype: error_max_turns",
      },
    ]);
  });

  it("returns [] for blank or whitespace lines", () => {
    expect(parseNdjsonLine("", TURN, createTaskMap())).toEqual([]);
    expect(parseNdjsonLine("   ", TURN, createTaskMap())).toEqual([]);
  });

  it("returns [] (does not throw) for malformed JSON", () => {
    expect(parseNdjsonLine("{not valid json", TURN, createTaskMap())).toEqual([]);
  });

  it("returns [] for unknown type (forward-compatible)", () => {
    const line = JSON.stringify({ type: "future_event_type", foo: "bar" });
    expect(parseNdjsonLine(line, TURN, createTaskMap())).toEqual([]);
  });

  it("handles the recorded fixture end-to-end", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const content = await readFile(resolve(here, "fixtures/sample-turn.ndjson"), "utf8");
    const lines = content.split("\n");
    const allEvents: BrokerToHost[] = [];
    const fixtureMap = createTaskMap();
    for (const line of lines) {
      allEvents.push(...parseNdjsonLine(line, TURN, fixtureMap));
    }
    expect(allEvents.length).toBeGreaterThan(0);
    // The last real event should be agent.done or agent.error
    const last = allEvents[allEvents.length - 1];
    expect(["agent.done", "agent.error"]).toContain(last?.type);
  });
});

describe("ndjson-parser agentId tagging", () => {
  function line(obj: unknown): string {
    return JSON.stringify(obj);
  }

  it("tags a Task tool_use with no agentId and records the mapping", () => {
    const map: TaskMap = createTaskMap();
    const events = parseNdjsonLine(
      line({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-1",
              name: "Task",
              input: { subagent_type: "planner", description: "x", prompt: "y" },
            },
          ],
        },
      }),
      "turn-1",
      map,
    );

    expect(map.has("tu-1")).toBe(true);
    expect(map.get("tu-1")).toBe("planner");
    const toolUseEvent = events.find((e) => e.type === "agent.tool_use");
    expect((toolUseEvent as { agentId?: string } | undefined)?.agentId).toBeUndefined();
  });

  it("tags an inner tool_use as coming from the mapped sub-agent", () => {
    const map: TaskMap = createTaskMap();
    map.set("tu-1", "planner");
    const events = parseNdjsonLine(
      line({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu-2",
              name: "Grep",
              input: { pattern: "foo" },
              parent_tool_use_id: "tu-1",
            },
          ],
        },
      }),
      "turn-1",
      map,
    );

    const toolUseEvent = events.find((e) => e.type === "agent.tool_use");
    expect((toolUseEvent as { agentId?: string } | undefined)?.agentId).toBe("planner");
  });

  it("tags text chunks under a sub-agent with agentId", () => {
    const map: TaskMap = createTaskMap();
    map.set("tu-1", "explorer");
    const events = parseNdjsonLine(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "I found 2 matches." },
          ],
          parent_tool_use_id: "tu-1",
        },
      }),
      "turn-1",
      map,
    );

    const chunk = events.find((e) => e.type === "agent.chunk");
    expect((chunk as { agentId?: string } | undefined)?.agentId).toBe("explorer");
  });

  it("leaves events without parent_tool_use_id untagged", () => {
    const map: TaskMap = createTaskMap();
    const events = parseNdjsonLine(
      line({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hi" }],
        },
      }),
      "turn-1",
      map,
    );
    const chunk = events.find((e) => e.type === "agent.chunk");
    expect((chunk as { agentId?: string } | undefined)?.agentId).toBeUndefined();
  });

  it("ignores parent_tool_use_id that was never registered", () => {
    const map: TaskMap = createTaskMap();
    const events = parseNdjsonLine(
      line({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "stray" }],
          parent_tool_use_id: "unknown-id",
        },
      }),
      "turn-1",
      map,
    );
    const chunk = events.find((e) => e.type === "agent.chunk");
    expect((chunk as { agentId?: string } | undefined)?.agentId).toBeUndefined();
  });

  it("createTaskMap returns a fresh map each call", () => {
    const a = createTaskMap();
    const b = createTaskMap();
    a.set("tu-1", "planner");
    expect(b.has("tu-1")).toBe(false);
  });
});
