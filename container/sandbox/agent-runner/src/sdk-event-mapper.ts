import type { BrokerToHost, AgentRuntime } from "@wbd/protocol";

export interface MapContext {
  turnId: string;
  runtime: AgentRuntime;
  agentId?: string;
}

export interface MapResult {
  events: BrokerToHost[];
  captured?: { providerSessionId?: string; modelId?: string };
  capturedMessageId?: string;
}

const RESULT_EXIT: Record<string, number> = {
  success: 0,
  error_max_turns: 2,
  error_max_budget_usd: 3,
  error_during_execution: 1,
  error_max_structured_output_retries: 4,
};

/**
 * Pure transform: consume one Claude Agent SDK message and emit zero or more
 * broker→host events plus optional captured session metadata.
 *
 * No I/O. No SDK runtime. Fully unit-testable.
 *
 * V1 mapping coverage:
 *   - system.init           → captured providerSessionId/modelId (no event)
 *   - stream_event /
 *     content_block_delta /
 *     text_delta            → agent.chunk
 *   - assistant.tool_use    → agent.tool_use (text blocks dropped)
 *   - user.tool_result      → dropped
 *   - result.*              → agent.done (exit code derived from subtype)
 *   - everything else       → dropped
 *
 * NOTE: agent.session is intentionally NOT emitted here. The runner that owns
 * resume detection emits it once it knows whether resume succeeded.
 */
export function mapSdkMessage(msg: unknown, ctx: MapContext): MapResult {
  if (!isRecord(msg)) return { events: [] };

  const type = (msg as { type?: unknown }).type;

  if (type === "system" && (msg as { subtype?: unknown }).subtype === "init") {
    const m = msg as { session_id?: unknown; model?: unknown };
    return {
      events: [],
      captured: {
        providerSessionId: typeof m.session_id === "string" ? m.session_id : undefined,
        modelId: typeof m.model === "string" ? m.model : undefined,
      },
    };
  }

  if (type === "stream_event") {
    const event = (msg as { event?: unknown }).event;
    if (
      isRecord(event) &&
      (event as { type?: unknown }).type === "content_block_delta"
    ) {
      const delta = (event as { delta?: unknown }).delta;
      if (
        isRecord(delta) &&
        (delta as { type?: unknown }).type === "text_delta"
      ) {
        const text = (delta as { text?: unknown }).text;
        return {
          events: [
            {
              type: "agent.chunk",
              turnId: ctx.turnId,
              delta: typeof text === "string" ? text : String(text ?? ""),
              ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
            },
          ],
        };
      }
    }
    return { events: [] };
  }

  if (type === "assistant") {
    const message = (msg as { message?: unknown }).message;
    const capturedMessageId =
      isRecord(message) && typeof (message as { id?: unknown }).id === "string"
        ? (message as { id: string }).id
        : undefined;
    const content = isRecord(message) ? (message as { content?: unknown }).content : undefined;
    if (!Array.isArray(content)) {
      return { events: [], ...(capturedMessageId ? { capturedMessageId } : {}) };
    }
    const events: BrokerToHost[] = [];
    for (const block of content) {
      if (isRecord(block) && (block as { type?: unknown }).type === "tool_use") {
        const b = block as { name?: unknown; input?: unknown };
        events.push({
          type: "agent.tool_use",
          turnId: ctx.turnId,
          tool: typeof b.name === "string" ? b.name : String(b.name ?? ""),
          input: b.input,
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        });
      }
    }
    return { events, ...(capturedMessageId ? { capturedMessageId } : {}) };
  }

  if (type === "result") {
    const r = msg as {
      subtype?: unknown;
      duration_ms?: unknown;
      total_cost_usd?: unknown;
      usage?: unknown;
    };
    const usage = isRecord(r.usage) ? r.usage : {};
    const subtype = typeof r.subtype === "string" ? r.subtype : "success";
    const tokensIn = numberOr0((usage as Record<string, unknown>).input_tokens);
    const tokensOut = numberOr0((usage as Record<string, unknown>).output_tokens);
    return {
      events: [
        {
          type: "agent.done",
          turnId: ctx.turnId,
          durationMs: numberOr0(r.duration_ms),
          tokensIn,
          tokensOut,
          costUsd: numberOr0(r.total_cost_usd),
          exitCode: RESULT_EXIT[subtype] ?? 1,
          subtype: subtype as BrokerToHostDoneSubtype,
        },
      ],
    };
  }

  return { events: [] };
}

type BrokerToHostDoneSubtype = Extract<BrokerToHost, { type: "agent.done" }>["subtype"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr0(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
