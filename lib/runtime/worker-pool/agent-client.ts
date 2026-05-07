import { createHmac } from "node:crypto";
import {
  AgentError,
  type CancelProjectRunRequest,
  type AgentClient,
  type CreateSandboxRequest,
  type CreateSandboxResponse,
  type DrainProjectQueueRequest,
  type ExecuteProjectRunRequest,
  type GitStatusRequest,
  type GitStatusResponse,
  type PushProjectGitChangesRequest,
  type PushProjectGitChangesResponse,
  type SandboxStatusResponse,
} from "./types";

export interface CreateAgentClientArgs {
  baseUrl: string;          // http://<ip>:4500
  hmacSecret: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createAgentClient(args: CreateAgentClientArgs): AgentClient {
  const fetchFn = args.fetch ?? globalThis.fetch;
  const timeout = args.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const ts = new Date().toISOString();
    const sig = createHmac("sha256", args.hmacSecret)
      .update(`${ts}.${method}.${path}.${raw}`).digest("hex");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetchFn(`${args.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": sig,
        },
        body: raw === "" ? undefined : raw,
        signal: ctrl.signal,
      });

      if (res.status === 204) return undefined as T;
      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;

      if (!res.ok) {
        const errorCode =
          typeof parsed === "object" &&
          parsed !== null &&
          "error" in parsed &&
          typeof parsed.error === "string"
            ? parsed.error
            : `http-${res.status}`;
        throw new AgentError(res.status, errorCode, `${method} ${path} → ${res.status} ${errorCode}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async function streamCall(
    method: string,
    path: string,
    body: unknown,
    onEvent: (event: unknown) => void | Promise<void>,
  ): Promise<void> {
    const raw = JSON.stringify(body);
    const ts = new Date().toISOString();
    const sig = createHmac("sha256", args.hmacSecret)
      .update(`${ts}.${method}.${path}.${raw}`).digest("hex");

    const res = await fetchFn(`${args.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-timestamp": ts,
        "x-signature": sig,
      },
      body: raw,
    });

    if (!res.ok) {
      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      const errorCode =
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof parsed.error === "string"
          ? parsed.error
          : `http-${res.status}`;
      throw new AgentError(res.status, errorCode, `${method} ${path} → ${res.status} ${errorCode}`);
    }

    await readNdjsonEvents(res, onEvent);
  }

  return {
    createSandbox: (req: CreateSandboxRequest) =>
      call<CreateSandboxResponse>("POST", "/sandboxes", req),
    destroySandbox: (id) => call<void>("DELETE", `/sandboxes/${encodeURIComponent(id)}`),
    getStatus: (id) =>
      call<SandboxStatusResponse>("GET", `/sandboxes/${encodeURIComponent(id)}`),
    listSandboxes: () =>
      call<SandboxStatusResponse[]>("GET", "/sandboxes"),
    drainProjectQueue: (sandboxId, projectId) => {
      const req: DrainProjectQueueRequest = { projectId };
      return call<void>(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/queue/drain`,
        req,
      );
    },
    cancelProjectRun: (sandboxId, projectId, runId) => {
      const req: CancelProjectRunRequest = { projectId, runId };
      return call<void>(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/runs/${encodeURIComponent(runId)}/cancel`,
        req,
      );
    },
    getProjectGitStatus: (sandboxId, projectId) => {
      const req: GitStatusRequest = { projectId };
      return call<GitStatusResponse>(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/git/status`,
        req,
      );
    },
    pushProjectGitChanges: (sandboxId, request: PushProjectGitChangesRequest) =>
      call<PushProjectGitChangesResponse>(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/git/push`,
        request,
      ),
    executeProjectRun: (sandboxId, request, onEvent) => {
      const req: ExecuteProjectRunRequest = request;
      return streamCall(
        "POST",
        `/sandboxes/${encodeURIComponent(sandboxId)}/runs/${encodeURIComponent(request.runId)}/execute`,
        req,
        onEvent,
      );
    },
    health: () => call("GET", "/health"),
  };
}

async function readNdjsonEvents(
  response: Response,
  onEvent: (event: unknown) => void | Promise<void>,
): Promise<void> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) await onEvent(JSON.parse(line) as unknown);
    }
  }

  buffer += decoder.decode();
  const line = buffer.trim();
  if (line) await onEvent(JSON.parse(line) as unknown);
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
