import type { AgentRuntime, BrokerToHost } from "@wbd/protocol";

export interface AgentTurnOptions {
  projectId: string;
  sessionId: string;
  resumeSession: boolean;
  prompt: string;
  turnId: string;
  projectRoot?: string;
  modelId?: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
}

export interface AgentReviewOptions {
  projectId: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
}

export interface AgentProvider {
  runtime: AgentRuntime;
  runTurn(opts: AgentTurnOptions): Promise<void>;
  runReview?(opts: AgentReviewOptions): Promise<void>;
}

export function agentRuntimeFromEnv(): AgentRuntime {
  const raw = (process.env.AGENT_RUNTIME ?? process.env.AGENT_PROVIDER ?? "claude-code")
    .trim()
    .toLowerCase();
  if (raw === "codex" || raw === "openai-codex" || raw === "openai-codex-sdk") {
    return "openai-codex";
  }
  if (raw === "vercel-ai" || raw === "vercel-ai-sdk") {
    return "vercel-ai";
  }
  if (raw === "openhands" || raw === "open-hands" || raw === "openhands-sdk") {
    return "openhands";
  }
  return "claude-code";
}
