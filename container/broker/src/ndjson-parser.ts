import type { AgentUsageDetails, BrokerToHost } from "@wbd/protocol";

/**
 * Per-turn mapping from Task tool_use id → sub-agent name.
 * Caller must create a fresh map per turn (via createTaskMap()) and pass the
 * same instance to every parseNdjsonLine call for that turn.
 */
export type TaskMap = Map<string, string>;

export function createTaskMap(): TaskMap {
  return new Map();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberField(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function usageDetails(msg: Record<string, unknown>): AgentUsageDetails | undefined {
  const usage = isRecord(msg.usage) ? msg.usage : undefined;
  if (!usage) return undefined;

  const serverToolUse = isRecord(usage.server_tool_use)
    ? usage.server_tool_use
    : undefined;
  const inputTokens = numberField(usage, "input_tokens");
  const outputTokens = numberField(usage, "output_tokens");
  const cacheCreationInputTokens = numberField(usage, "cache_creation_input_tokens");
  const cacheReadInputTokens = numberField(usage, "cache_read_input_tokens");

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens:
      inputTokens +
      outputTokens +
      cacheCreationInputTokens +
      cacheReadInputTokens,
    webSearchRequests: numberField(serverToolUse, "web_search_requests"),
    webFetchRequests: numberField(serverToolUse, "web_fetch_requests"),
    rawUsage: usage,
    ...(isRecord(msg.modelUsage) ? { modelUsage: msg.modelUsage } : {}),
    ...(stringField(usage, "service_tier") ? { serviceTier: stringField(usage, "service_tier") } : {}),
    ...(stringField(usage, "inference_geo") ? { inferenceGeo: stringField(usage, "inference_geo") } : {}),
  };
}

export function parseNdjsonLine(
  line: string,
  turnId: string,
  taskMap: TaskMap,
): BrokerToHost[] {
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
    const events: BrokerToHost[] = [];
    if (typeof msg.session_id === "string") {
      events.push({ type: "agent.session", turnId, claudeSessionId: msg.session_id });
    }
    events.push({ type: "agent.status", turnId, phase: "starting" });
    return events;
  }

  if (type === "assistant") {
    const message = msg.message as
      | {
          content?: Array<Record<string, unknown>>;
          parent_tool_use_id?: string;
        }
      | undefined;
    const content = message?.content ?? [];
    const messageParent = message?.parent_tool_use_id;

    const events: BrokerToHost[] = [];
    for (const block of content) {
      const blockParent =
        typeof block.parent_tool_use_id === "string"
          ? block.parent_tool_use_id
          : messageParent;
      const agentId =
        typeof blockParent === "string" ? taskMap.get(blockParent) : undefined;

      if (block.type === "text" && typeof block.text === "string") {
        events.push({
          type: "agent.chunk",
          turnId,
          delta: block.text,
          ...(agentId ? { agentId } : {}),
        });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const toolUseId = typeof block.id === "string" ? block.id : undefined;
        const input = block.input;
        if (
          block.name === "Task" &&
          toolUseId &&
          input &&
          typeof input === "object" &&
          typeof (input as Record<string, unknown>).subagent_type === "string"
        ) {
          taskMap.set(
            toolUseId,
            (input as Record<string, unknown>).subagent_type as string,
          );
        }

        events.push({
          type: "agent.tool_use",
          turnId,
          tool: block.name,
          input,
          ...(agentId ? { agentId } : {}),
        });
        events.push({
          type: "agent.status",
          turnId,
          phase: "tool_use",
          detail: block.name,
          ...(agentId ? { agentId } : {}),
        });
      }
    }
    return events;
  }

  if (type === "user") {
    return [];
  }

  if (type === "result") {
    if (msg.subtype === "success") {
      const usage = usageDetails(msg);
      const events: BrokerToHost[] = [];
      if (typeof msg.session_id === "string") {
        events.push({ type: "agent.session", turnId, claudeSessionId: msg.session_id });
      }
      events.push({
        type: "agent.done",
        turnId,
        durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : 0,
        tokensIn: usage?.inputTokens ?? 0,
        tokensOut: usage?.outputTokens ?? 0,
        costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0,
        exitCode: 0,
        ...(usage ? { usage } : {}),
      });
      return events;
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
