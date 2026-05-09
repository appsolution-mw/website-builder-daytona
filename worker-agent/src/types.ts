import type { PromptImageAttachment } from "@wbd/protocol";

export interface CreateSandboxRequest {
  sandboxId: string;
  projectId: string;
  image: string;
  env: Record<string, string>;
  brokerToken: string;
}

export interface CreateSandboxResponse {
  sandboxId: string;
  containerId: string;
  brokerPort: number;
  previewPort: number;
  status: "spawning";
}

export interface SandboxStatusResponse {
  sandboxId: string;
  containerId?: string;
  brokerPort?: number;
  previewPort?: number;
  status: "spawning" | "running" | "stopped" | "gone";
}

export interface DrainProjectQueueRequest {
  projectId: string;
}

export interface CancelProjectRunRequest {
  projectId: string;
  runId: string;
}

export interface GitStatusRequest {
  projectId: string;
}

export interface GitStatusResponse {
  ok: true;
  hasChanges: boolean;
  entries: string[];
  porcelain: string[];
}

export interface PushProjectGitChangesRequest {
  projectId: string;
  remoteUrl: string;
  remoteAuth?: {
    username: string;
    password: string;
  };
  branch: string;
  commitMessage: string;
}

export type PushProjectGitChangesResponse =
  | { ok: true; branch: string; commitSha: string }
  | { ok: false; reason: "no_changes"; message: string };

export type WorkerAgentRuntime =
  | "claude-code"
  | "openai-codex"
  | "vercel-ai"
  | "openhands";

export interface ExecuteProjectRunRequest {
  projectId: string;
  sessionId: string;
  providerSessionId: string;
  runId: string;
  attemptId: string;
  prompt: string;
  runtime: WorkerAgentRuntime;
  resumeSession: boolean;
  modelId?: string;
  attachments?: PromptImageAttachment[];
  /**
   * Optional last-N message replay context (Task 14). Only forwarded for
   * the claude-code runtime — passed as-is from the host to the broker so
   * the agent-runner can fall back to a transcript when SDK resume fails.
   */
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface BrokerCommandResponse {
  ok: boolean;
}

export interface HealthResponse {
  ok: true;
  dockerVersion: string;
  uptime: number;
  count: number;
}

export interface ErrorResponse {
  error: string;
  reason?: string;
}
