import type {
  AgentClient,
  CreateSandboxRequest,
  CreateSandboxResponse,
  SandboxStatusResponse,
} from "./types";

export type FakeAgentCommandRequest =
  | { type: "queue.drain"; sandboxId: string; projectId: string }
  | { type: "run.cancel"; sandboxId: string; projectId: string; runId: string }
  | { type: "run.execute"; sandboxId: string; projectId: string; runId: string };

export interface FakeAgentClientHandles {
  client: AgentClient;
  /** Force the next createSandbox to throw with this AgentError-like body. */
  failNext: (statusCode: number, errorCode: string) => void;
  /** Inspect what was created. */
  list(): SandboxStatusResponse[];
  /** Inspect createSandbox requests sent to the fake agent. */
  requests(): CreateSandboxRequest[];
  /** Inspect queue/run command requests sent to the fake agent. */
  commandRequests(): FakeAgentCommandRequest[];
}

export function createFakeAgentClient(): FakeAgentClientHandles {
  const map = new Map<string, SandboxStatusResponse>();
  const requests: CreateSandboxRequest[] = [];
  const commandRequests: FakeAgentCommandRequest[] = [];
  let nextFailure: { statusCode: number; errorCode: string } | null = null;
  let portCounter = 33000;

  const client: AgentClient = {
    async createSandbox(req: CreateSandboxRequest): Promise<CreateSandboxResponse> {
      if (nextFailure) {
        const f = nextFailure; nextFailure = null;
        const e = new Error(`fake-fail ${f.errorCode}`) as Error & { statusCode: number; errorCode: string };
        e.statusCode = f.statusCode; e.errorCode = f.errorCode;
        throw e;
      }
      requests.push(req);
      const broker = portCounter++;
      const preview = portCounter++;
      const r: CreateSandboxResponse = {
        sandboxId: req.sandboxId,
        containerId: `cid-${req.sandboxId}`,
        brokerPort: broker, previewPort: preview, status: "spawning",
      };
      map.set(req.sandboxId, { ...r, status: "running" });
      return r;
    },
    async destroySandbox(id) { map.delete(id); },
    async getStatus(id) {
      return map.get(id) ?? { sandboxId: id, status: "gone" };
    },
    async listSandboxes() { return [...map.values()]; },
    async drainProjectQueue(sandboxId, projectId) {
      commandRequests.push({ type: "queue.drain", sandboxId, projectId });
    },
    async cancelProjectRun(sandboxId, projectId, runId) {
      commandRequests.push({ type: "run.cancel", sandboxId, projectId, runId });
    },
    async executeProjectRun(sandboxId, request, onEvent) {
      commandRequests.push({
        type: "run.execute",
        sandboxId,
        projectId: request.projectId,
        runId: request.runId,
      });
      await onEvent({
        type: "agent.done",
        turnId: request.runId,
        durationMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        exitCode: 0,
      });
    },
    async health() {
      return { ok: true, dockerVersion: "fake", uptime: 0, count: map.size };
    },
  };

  return {
    client,
    failNext: (statusCode, errorCode) => { nextFailure = { statusCode, errorCode }; },
    list: () => [...map.values()],
    requests: () => [...requests],
    commandRequests: () => [...commandRequests],
  };
}
