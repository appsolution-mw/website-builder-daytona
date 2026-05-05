import type { CaddyRoute } from "./caddy-config";

const CADDY_ROUTE_COLLECTION_PATH = "/config/apps/http/servers/srv0/routes";
const MAX_ERROR_BODY_LENGTH = 500;

export interface CaddyClient {
  applyRoute(routeId: string, route: CaddyRoute): Promise<void>;
  deleteRoute(routeId: string): Promise<void>;
}

export function createCaddyClient(adminUrl: string, fetchImpl: typeof fetch = fetch): CaddyClient {
  const normalizedAdminUrl = adminUrl.replace(/\/+$/, "");

  function buildRouteCollectionUrl(): string {
    return `${normalizedAdminUrl}${CADDY_ROUTE_COLLECTION_PATH}`;
  }

  function buildRouteIdUrl(routeId: string): string {
    return `${normalizedAdminUrl}/id/${encodeURIComponent(routeId)}`;
  }

  async function applyRoute(routeId: string, route: CaddyRoute): Promise<void> {
    const routeWithId: CaddyRoute = { ...route, "@id": routeId };
    const patchResponse = await requestCaddy(fetchImpl, "apply", routeId, buildRouteIdUrl(routeId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routeWithId),
    });

    if (patchResponse.ok) {
      return;
    }

    if (patchResponse.status !== 404) {
      throw new Error(await buildCaddyErrorMessage("apply", routeId, patchResponse));
    }

    const postResponse = await requestCaddy(fetchImpl, "apply", routeId, buildRouteCollectionUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routeWithId),
    });

    if (!postResponse.ok) {
      throw new Error(await buildCaddyErrorMessage("apply", routeId, postResponse));
    }
  }

  async function deleteRoute(routeId: string): Promise<void> {
    const response = await requestCaddy(fetchImpl, "delete", routeId, buildRouteIdUrl(routeId), {
      method: "DELETE",
    });

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(await buildCaddyErrorMessage("delete", routeId, response));
    }
  }

  return { applyRoute, deleteRoute };
}

async function requestCaddy(
  fetchImpl: typeof fetch,
  action: "apply" | "delete",
  routeId: string,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to ${action} Caddy route ${routeId}: ${error.message}`);
    }
    throw new Error(`Failed to ${action} Caddy route ${routeId}: network request failed`);
  }
}

async function buildCaddyErrorMessage(
  action: "apply" | "delete",
  routeId: string,
  response: Response,
): Promise<string> {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const body = await readResponseBody(response);
  const bodySuffix = body ? ` - ${body}` : "";

  return `Failed to ${action} Caddy route ${routeId}: ${response.status}${statusText}${bodySuffix}`;
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return truncateErrorBody(redactErrorBody((await response.text()).trim()));
  } catch (error: unknown) {
    if (error instanceof Error) {
      return `unable to read response body: ${error.message}`;
    }

    return "unable to read response body";
  }
}

function redactErrorBody(body: string): string {
  return body
    .replace(/("?(?:token|secret|password|authorization)"?\s*[:=]\s*)("[^"]+"|[^\s,}]+)/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

function truncateErrorBody(body: string): string {
  if (body.length <= MAX_ERROR_BODY_LENGTH) return body;
  return `${body.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}
