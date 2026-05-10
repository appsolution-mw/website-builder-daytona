/**
 * Direct host→broker JSON-RPC over the broker's internal HTTP surface.
 *
 * The broker's `/internal/*` routes are POST-only and authenticated with a
 * bearer token (`BROKER_TOKEN`). The token is the same value stored on
 * `Project.brokerPreviewToken` (see `lib/runtime/worker-pool/runtime.ts` —
 * `brokerPreviewToken: brokerToken`). The broker validates it via the
 * `Authorization: Bearer …` header.
 */

const PROJECT_SCOPE = "host"; // single internal projectId namespace for the broker route regex

export interface BrokerRpcProject {
  brokerUrl: string;
  brokerPreviewToken: string | null;
}

export class BrokerRpcError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly bodyText: string,
  ) {
    super(message);
    this.name = "BrokerRpcError";
  }
}

export async function brokerJsonRpc<T>(
  project: BrokerRpcProject,
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const url = buildBrokerHttpUrl(project.brokerUrl, path);
  const token = project.brokerPreviewToken ?? "";
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BrokerRpcError(
        `broker rpc ${path} failed: ${response.status}`,
        response.status,
        text,
      );
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BrokerRpcError(
        `broker rpc ${path} timed out after ${timeoutMs}ms`,
        0,
        "",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildBrokerHttpUrl(brokerUrl: string, path: string): string {
  // brokerUrl is a ws/wss URL (with optional preview token query string). Convert
  // it into the matching http/https URL on the same host+port and append the
  // internal route path.
  const url = new URL(brokerUrl);
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  const httpUrl = new URL(`${protocol}//${url.host}`);
  httpUrl.pathname = `/internal/projects/${encodeURIComponent(PROJECT_SCOPE)}${path}`;
  // Preserve any query params from brokerUrl (e.g. preview token).
  for (const [key, value] of url.searchParams) {
    httpUrl.searchParams.set(key, value);
  }
  return httpUrl.toString();
}

export async function brokerGetCommitFiles(
  project: BrokerRpcProject,
  sha: string,
): Promise<{ files: { path: string; insertions: number; deletions: number }[] }> {
  return brokerJsonRpc(project, "/git/commit-files", { sha });
}

export async function brokerGetCommitDiff(
  project: BrokerRpcProject,
  sha: string,
  path: string,
): Promise<{ diff: string }> {
  return brokerJsonRpc(project, "/git/commit-diff", { sha, path });
}

export type BrokerRevertResult =
  | {
      ok: true;
      sha: string;
      shortSha: string;
      title: string;
      bodyMessage: string;
      filesChanged: number;
      insertions: number;
      deletions: number;
      revertedFromSha: string;
      committedAt: string;
    }
  | { ok: false; reason: "unknown_sha" | "is_head" | "dirty_tree" }
  | { ok: false; reason: "commit_failed"; detail: string };

export async function brokerRevertToCommit(
  project: BrokerRpcProject,
  sha: string,
  triggeredBy: string,
): Promise<BrokerRevertResult> {
  return brokerJsonRpc<BrokerRevertResult>(
    project,
    "/git/revert",
    { sha, triggeredBy },
    { timeoutMs: 60_000 },
  );
}
