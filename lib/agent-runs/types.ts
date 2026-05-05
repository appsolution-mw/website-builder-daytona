import type { AgentRuntime } from "@wbd/protocol";

export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AgentRunAttemptStatus =
  | "STARTING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AgentRunEventType =
  | "STATUS"
  | "CHUNK"
  | "TOOL_USE"
  | "USAGE"
  | "DONE"
  | "ERROR"
  | "FILE_CHANGED";

export type SerializableRunEvent = {
  id: string;
  runId: string;
  attemptId: string | null;
  projectId: string;
  sessionId: string;
  sequence: number;
  type: AgentRunEventType;
  agentId: string | null;
  payload: unknown;
  createdAt: string;
};

export type CreateRunInput = {
  projectId: string;
  sessionId: string;
  createdById: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
};
