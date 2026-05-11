import { describe, it, expect } from "vitest";
import { mapSdkMessage } from "../src/sdk-event-mapper.js";

// Permissive structural alias for SDK message fixtures. The full SDK message
// union is complex and varies across cases tested here; we deliberately don't
// narrow it in fixtures to keep tests terse and resilient to SDK type churn.
type SdkMessageFake = { type: string; [k: string]: unknown };

const ctx = { turnId: "T1", runtime: "claude-code" as const };

describe("mapSdkMessage", () => {
  it("system.init captures session_id without emitting", () => {
    const out = mapSdkMessage(
      { type: "system", subtype: "init", session_id: "s1", model: "claude-sonnet-4-6" } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([]);
    expect(out.captured).toEqual({ providerSessionId: "s1", modelId: "claude-sonnet-4-6" });
  });

  it("text_delta stream_event → agent.chunk", () => {
    const out = mapSdkMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([{ type: "agent.chunk", turnId: "T1", delta: "Hi" }]);
  });

  it("non-text content_block_delta is dropped (V1)", () => {
    const out = mapSdkMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([]);
  });

  it("assistant tool_use block → agent.tool_use", () => {
    const out = mapSdkMessage(
      { type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { path: "x" } }] } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([{ type: "agent.tool_use", turnId: "T1", tool: "Read", input: { path: "x" } }]);
  });

  it("assistant text blocks are NOT mapped (only tool_use)", () => {
    const out = mapSdkMessage(
      { type: "assistant", message: { content: [{ type: "text", text: "blah" }] } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([]);
  });

  it("user message (tool_result) is dropped — V1 doesn't forward results", () => {
    const out = mapSdkMessage(
      { type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "id", content: "ok" }] } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([]);
  });

  it("result.success → agent.done with subtype + cost + tokens + exit 0", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "success", duration_ms: 1234, total_cost_usd: 0.012,
        usage: { input_tokens: 10, output_tokens: 20 } } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({
      type: "agent.done",
      turnId: "T1",
      durationMs: 1234,
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 0.012,
      exitCode: 0,
      subtype: "success",
    });
  });

  it("result.error_max_turns → agent.done with non-zero exit", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "error_max_turns", duration_ms: 100, total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 } } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({ subtype: "error_max_turns", exitCode: 2 });
  });

  it("result.error_during_execution → agent.done with exit 1", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "error_during_execution", duration_ms: 0, total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 } } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({ subtype: "error_during_execution", exitCode: 1 });
  });

  it("missing usage on result still produces an event with zero tokens", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "success", duration_ms: 0, total_cost_usd: 0 } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({ tokensIn: 0, tokensOut: 0 });
  });

  it("unknown message types produce no events", () => {
    const out = mapSdkMessage({ type: "something_unknown" } as SdkMessageFake, ctx);
    expect(out.events).toEqual([]);
  });

  it("agentId from ctx propagates onto events that support it", () => {
    const out = mapSdkMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } } as SdkMessageFake,
      { ...ctx, agentId: "code-reviewer" },
    );
    expect(out.events[0]).toMatchObject({ agentId: "code-reviewer" });
  });

  it("agentId from ctx propagates to agent.tool_use as well", () => {
    const out = mapSdkMessage(
      { type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] } } as SdkMessageFake,
      { ...ctx, agentId: "code-reviewer" },
    );
    expect(out.events[0]).toMatchObject({ agentId: "code-reviewer" });
  });

  it("agent.done never carries agentId, even when ctx provides one", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "success", duration_ms: 1, total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 } } as SdkMessageFake,
      { ...ctx, agentId: "code-reviewer" },
    );
    expect((out.events[0] as { agentId?: string }).agentId).toBeUndefined();
  });

  it("result.error_max_budget_usd → exit code 3", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "error_max_budget_usd", duration_ms: 0, total_cost_usd: 5,
        usage: { input_tokens: 0, output_tokens: 0 } } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({ subtype: "error_max_budget_usd", exitCode: 3 });
  });

  it("result.error_max_structured_output_retries → exit code 4", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "error_max_structured_output_retries", duration_ms: 0,
        total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } } as SdkMessageFake,
      ctx,
    );
    expect(out.events[0]).toMatchObject({ subtype: "error_max_structured_output_retries", exitCode: 4 });
  });

  it("assistant with message.id captures capturedMessageId", () => {
    const out = mapSdkMessage(
      { type: "assistant", message: { id: "gen-abc123", content: [{ type: "text", text: "hi" }] } } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([]);
    expect(out.capturedMessageId).toBe("gen-abc123");
  });

  it("assistant with message.id AND tool_use captures both id and tool_use event", () => {
    const out = mapSdkMessage(
      {
        type: "assistant",
        message: {
          id: "gen-xyz789",
          content: [{ type: "tool_use", name: "Read", input: { path: "a" } }],
        },
      } as SdkMessageFake,
      ctx,
    );
    expect(out.events).toEqual([
      { type: "agent.tool_use", turnId: "T1", tool: "Read", input: { path: "a" } },
    ]);
    expect(out.capturedMessageId).toBe("gen-xyz789");
  });

  it("assistant without message.id leaves capturedMessageId undefined", () => {
    const out = mapSdkMessage(
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } } as SdkMessageFake,
      ctx,
    );
    expect(out.capturedMessageId).toBeUndefined();
  });
});
