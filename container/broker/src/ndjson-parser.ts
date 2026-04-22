import type { BrokerToHost } from "@wbd/protocol";

/**
 * Map one line of Claude Code stream-json output to zero or more protocol events.
 *
 * Design: pure function, no I/O, no state. The caller (claude-runner) is
 * responsible for line-splitting and for tracking the turn that owns the stream.
 *
 * Forward-compatibility: unknown `type` values return [] rather than throwing,
 * so a future Claude Code release adding new event types doesn't crash the broker.
 */
export function parseNdjsonLine(line: string, turnId: string): BrokerToHost[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  const msg = parsed as Record<string, unknown>;
  const type = msg.type;

  if (type === "system" && msg.subtype === "init") {
    return [{ type: "agent.status", turnId, phase: "starting" }];
  }

  if (type === "assistant") {
    const message = msg.message as { content?: Array<Record<string, unknown>> } | undefined;
    const content = message?.content ?? [];
    const events: BrokerToHost[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        events.push({ type: "agent.chunk", turnId, delta: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        events.push({
          type: "agent.tool_use",
          turnId,
          tool: block.name,
          input: block.input,
        });
        events.push({
          type: "agent.status",
          turnId,
          phase: "tool_use",
          detail: block.name,
        });
      }
    }
    return events;
  }

  if (type === "user") {
    // Tool results — no UI event needed; the status was emitted on tool_use.
    return [];
  }

  if (type === "result") {
    if (msg.subtype === "success") {
      const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return [
        {
          type: "agent.done",
          turnId,
          durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : 0,
          tokensIn: usage?.input_tokens ?? 0,
          tokensOut: usage?.output_tokens ?? 0,
          costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0,
          exitCode: 0,
        },
      ];
    }
    return [
      {
        type: "agent.error",
        turnId,
        message: `claude terminated with subtype: ${String(msg.subtype ?? "unknown")}`,
      },
    ];
  }

  return [];
}
