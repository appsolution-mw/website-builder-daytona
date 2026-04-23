/**
 * WebSocket message protocol shared between host (ws-proxy) and broker.
 * All messages are JSON; both directions use a `type` discriminator.
 */

export type PromptImageAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string;
};

export type AgentRuntime = "claude-code" | "openai-codex" | "vercel-ai";

export type AgentUsageLabel = "coder" | "reviewer" | "turn";

export type AgentUsageDetails = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  rawUsage: unknown;
  modelUsage?: unknown;
  serviceTier?: string;
  inferenceGeo?: string;
};

export type AgentUsageEvent = {
  type: "agent.usage";
  turnId: string;
  label: AgentUsageLabel;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exitCode: number;
  usage?: AgentUsageDetails;
};

// Messages from host → broker
export type HostToBroker =
  | { type: "ping"; nonce: string }
  | {
      type: "agent.prompt";
      prompt: string;
      turnId: string;
      runtime: AgentRuntime;
      sessionId: string;
      providerSessionId: string;
      resumeSession: boolean;
      modelId?: string;
      attachments?: PromptImageAttachment[];
    }
  | { type: "agent.abort"; turnId: string }
  | { type: "file.list"; requestId: string }
  | { type: "file.read"; requestId: string; path: string }
  | { type: "file.write"; requestId: string; path: string; content: string };

// Messages from broker → host
export type BrokerToHost =
  | { type: "pong"; nonce: string }
  | { type: "error"; code: string; message: string }
  | {
      type: "agent.status";
      turnId: string;
      phase: "starting" | "thinking" | "tool_use" | "writing_file" | "reviewing" | "done";
      agentId?: string;
      detail?: string;
    }
  | {
      type: "agent.session";
      turnId: string;
      runtime: AgentRuntime;
      providerSessionId: string;
      modelId?: string;
    }
  | { type: "agent.chunk"; turnId: string; delta: string; agentId?: string }
  | {
      type: "agent.tool_use";
      turnId: string;
      tool: string;
      input: unknown;
      agentId?: string;
    }
  | {
      type: "agent.done";
      turnId: string;
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      exitCode: number;
      usage?: AgentUsageDetails;
    }
  | AgentUsageEvent
  | { type: "agent.error"; turnId: string; message: string; agentId?: string }
  | {
      type: "file.list.result";
      requestId: string;
      paths: string[];
    }
  | {
      type: "file.content";
      requestId: string;
      path: string;
      content?: string;
      error?: "not_found" | "too_large" | "invalid_path" | "io_error" | "binary";
    }
  | {
      type: "file.write.result";
      requestId: string;
      path: string;
      ok: boolean;
      reason?: "locked" | "too_large" | "invalid_path" | "io_error";
    }
  | {
      type: "file.changed";
      path: string;
      event: "add" | "change" | "unlink";
      source: "agent" | "external";
    };

// Messages the browser receives from the ws-proxy (currently identical to BrokerToHost)
export type ProxyToBrowser = BrokerToHost;

// Messages the browser sends to the ws-proxy (currently identical to HostToBroker)
export type BrowserToProxy = HostToBroker;

export const PROTOCOL_VERSION = "1.9.0" as const;
