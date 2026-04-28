/**
 * Wire shapes shared with the worker-agent. Mirror of worker-agent/src/types.ts —
 * keep these in sync; both sides serialize identically.
 */

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

export interface AgentClient {
  createSandbox(req: CreateSandboxRequest): Promise<CreateSandboxResponse>;
  destroySandbox(sandboxId: string): Promise<void>;
  getStatus(sandboxId: string): Promise<SandboxStatusResponse>;
  listSandboxes(): Promise<SandboxStatusResponse[]>;
  health(): Promise<{ ok: boolean; dockerVersion: string; uptime: number; count: number }>;
}

export class AgentError extends Error {
  constructor(public statusCode: number, public errorCode: string, message: string) {
    super(message);
    this.name = "AgentError";
  }
}
