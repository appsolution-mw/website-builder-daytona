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
