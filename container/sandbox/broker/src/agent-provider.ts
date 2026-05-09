import type { AgentRuntime, BrokerToHost, PromptImageAttachment } from "@wbd/protocol";

export interface AgentRunMetadata {
  runId: string;
  attemptId: string;
  conversationId?: string;
  persistenceDir?: string;
  resumeState?: unknown;
}

export interface AgentTurnOptions {
  projectId: string;
  sessionId: string;
  resumeSession: boolean;
  prompt: string;
  turnId: string;
  projectRoot?: string;
  modelId?: string;
  attachments?: PromptImageAttachment[];
  /**
   * Absolute paths to image files already written to the sandbox disk. Used by
   * the openai-codex runner to forward images as multimodal `local_image`
   * inputs. Broker-internal: not part of the host↔broker protocol.
   */
  attachmentPaths?: string[];
  /**
   * Last-N replay context (Task 14). Forwarded only by the claude-code provider
   * to the agent-runner; ignored by other runtimes. Always sent on every turn so
   * the runner can fall back to a transcript when SDK resume fails.
   */
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  onEvent: (event: BrokerToHost) => unknown;
  signal?: AbortSignal;
  run?: AgentRunMetadata;
}

export interface AgentReviewOptions {
  projectId: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => unknown;
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
