import type { BrokerToHost } from "@wbd/protocol";

/**
 * Per-turn mapping from Task tool_use id → sub-agent name.
 * Caller must create a fresh map per turn (via createTaskMap()) and pass the
 * same instance to every parseNdjsonLine call for that turn.
 */
export type TaskMap = Map<string, string>;

export function createTaskMap(): TaskMap {
  return new Map();
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
    return [{ type: "agent.status", turnId, phase: "starting" }];
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
      const usage = msg.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
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
