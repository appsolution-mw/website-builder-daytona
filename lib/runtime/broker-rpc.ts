/**
 * Direct host→broker JSON-RPC over the broker's internal HTTP surface.
 *
 * The broker's `/internal/*` routes are POST-only and authenticated with a
 * bearer token (`BROKER_TOKEN`). For the worker-pool runtime, that token is
 * the same value stored on `Project.brokerPreviewToken` (see
 * `lib/runtime/worker-pool/runtime.ts` — `brokerPreviewToken: brokerToken`).
 * For the Daytona runtime, `brokerPreviewToken` is the Daytona preview-proxy
 * token; the proxy validates it via the `x-daytona-preview-token` header.
 *
 * To stay compatible with both, we send the same secret as both `Authorization`
 * and `x-daytona-preview-token`. The broker rejects the request with a
 * non-Bearer credential gracefully if the token doesn't match the broker's
 * expected `BROKER_TOKEN`; the host caller must then surface that.
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
): Promise<T> {
  const url = buildBrokerHttpUrl(project.brokerUrl, path);
  const token = project.brokerPreviewToken ?? "";
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers["x-daytona-preview-token"] = token;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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
}

function buildBrokerHttpUrl(brokerUrl: string, path: string): string {
  // brokerUrl is a ws/wss URL (with optional preview token query string). Convert
  // it into the matching http/https URL on the same host+port and append the
  // internal route path.
  const url = new URL(brokerUrl);
  const protocol = url.protocol === "wss:" ? "https:" : "http:";
  const httpUrl = new URL(`${protocol}//${url.host}`);
  httpUrl.pathname = `/internal/projects/${encodeURIComponent(PROJECT_SCOPE)}${path}`;
  // Preserve any query params from brokerUrl (e.g. daytona preview token).
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
