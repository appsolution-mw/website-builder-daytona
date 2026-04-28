import type { AgentUsageDetails, BrokerToHost } from "@wbd/protocol";

const OPENHANDS_STATUS_PHASES = new Set(["starting", "thinking", "tool_use", "writing_file"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalAgentId(record: Record<string, unknown>): string | undefined {
  return typeof record.agentId === "string" && record.agentId.length > 0 ? record.agentId : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageDetails(tokensIn: number, tokensOut: number, rawUsage: unknown): AgentUsageDetails {
  return {
    inputTokens: tokensIn,
    outputTokens: tokensOut,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: tokensIn + tokensOut,
    webSearchRequests: 0,
    webFetchRequests: 0,
    rawUsage,
    modelUsage: rawUsage,
  };
}

export function parseOpenHandsBridgeLine(line: string, turnId: string): BrokerToHost | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  const agentId = optionalAgentId(parsed);

  switch (parsed.type) {
    case "chunk":
      if (typeof parsed.delta !== "string") return null;
      return {
        type: "agent.chunk",
        turnId,
        delta: parsed.delta,
        ...(agentId ? { agentId } : {}),
      };
    case "tool":
      if (typeof parsed.tool !== "string") return null;
      return {
        type: "agent.tool_use",
        turnId,
        tool: parsed.tool,
        input: parsed.input,
        ...(agentId ? { agentId } : {}),
      };
    case "status":
      if (typeof parsed.phase !== "string" || !OPENHANDS_STATUS_PHASES.has(parsed.phase)) return null;
      return {
        type: "agent.status",
        turnId,
        phase: parsed.phase as "starting" | "thinking" | "tool_use" | "writing_file",
        ...(typeof parsed.detail === "string" ? { detail: parsed.detail } : {}),
        ...(agentId ? { agentId } : {}),
      };
    case "done": {
      const tokensIn = numberField(parsed, "tokensIn");
      const tokensOut = numberField(parsed, "tokensOut");
      return {
        type: "agent.done",
        turnId,
        durationMs: numberField(parsed, "durationMs"),
        tokensIn,
        tokensOut,
        costUsd: numberField(parsed, "costUsd"),
        exitCode: 0,
        ...(parsed.usage !== undefined ? { usage: usageDetails(tokensIn, tokensOut, parsed.usage) } : {}),
      };
    }
    case "error":
      if (typeof parsed.message !== "string") return null;
      return {
        type: "agent.error",
        turnId,
        message: parsed.message,
        ...(agentId ? { agentId } : {}),
      };
    default:
      return null;
  }
}
