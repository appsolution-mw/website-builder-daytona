/**
 * Wire shapes shared with the worker-agent. Mirror of worker-agent/src/types.ts —
 * keep these in sync; both sides serialize identically.
 */

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
   * Optional last-N message replay context (Task 14). Only set for the
   * claude-code runtime; the agent-runner uses it as a fallback when SDK
   * resume cannot rehydrate a session.
   */
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface AgentClient {
  createSandbox(req: CreateSandboxRequest): Promise<CreateSandboxResponse>;
  destroySandbox(sandboxId: string): Promise<void>;
  attachSandboxToken(sandboxId: string, brokerToken: string): Promise<void>;
  getStatus(sandboxId: string): Promise<SandboxStatusResponse>;
  listSandboxes(): Promise<SandboxStatusResponse[]>;
  drainProjectQueue(sandboxId: string, projectId: string): Promise<void>;
  cancelProjectRun(sandboxId: string, projectId: string, runId: string): Promise<void>;
  getProjectGitStatus(sandboxId: string, projectId: string): Promise<GitStatusResponse>;
  pushProjectGitChanges(
    sandboxId: string,
    request: PushProjectGitChangesRequest,
  ): Promise<PushProjectGitChangesResponse>;
  executeProjectRun(
    sandboxId: string,
    request: ExecuteProjectRunRequest,
    onEvent: (event: unknown) => void | Promise<void>,
  ): Promise<void>;
  health(): Promise<{ ok: boolean; dockerVersion: string; uptime: number; count: number }>;
}

export class AgentError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
    this.name = "AgentError";
  }
}
