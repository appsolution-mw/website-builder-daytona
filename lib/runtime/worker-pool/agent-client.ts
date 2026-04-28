import { createHmac } from "node:crypto";
import {
  AgentError,
  type AgentClient,
  type CreateSandboxRequest,
  type CreateSandboxResponse,
  type SandboxStatusResponse,
} from "./types";

export interface CreateAgentClientArgs {
  baseUrl: string;          // http://<ip>:4500
  hmacSecret: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function createAgentClient(args: CreateAgentClientArgs): AgentClient {
  const fetchFn = args.fetch ?? globalThis.fetch;
  const timeout = args.timeoutMs ?? 10_000;

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
        const errorCode = (parsed && (parsed as { error?: string }).error) ?? `http-${res.status}`;
        throw new AgentError(res.status, errorCode, `${method} ${path} → ${res.status} ${errorCode}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    createSandbox: (req: CreateSandboxRequest) =>
      call<CreateSandboxResponse>("POST", "/sandboxes", req),
    destroySandbox: (id) => call<void>("DELETE", `/sandboxes/${encodeURIComponent(id)}`),
    getStatus: (id) =>
      call<SandboxStatusResponse>("GET", `/sandboxes/${encodeURIComponent(id)}`),
    listSandboxes: () =>
      call<SandboxStatusResponse[]>("GET", "/sandboxes"),
    health: () => call("GET", "/health"),
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
