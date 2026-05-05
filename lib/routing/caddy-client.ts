import type { CaddyRoute } from "./caddy-config";

const CADDY_ROUTE_PATH = "/config/apps/http/servers/srv0/routes";

export interface CaddyClient {
  applyRoute(routeId: string, route: CaddyRoute): Promise<void>;
  deleteRoute(routeId: string): Promise<void>;
}

export function createCaddyClient(adminUrl: string, fetchImpl: typeof fetch = fetch): CaddyClient {
  const normalizedAdminUrl = adminUrl.replace(/\/+$/, "");

  function buildRouteUrl(routeId: string): string {
    return `${normalizedAdminUrl}${CADDY_ROUTE_PATH}/${encodeURIComponent(routeId)}`;
  }

  async function applyRoute(routeId: string, route: CaddyRoute): Promise<void> {
    const response = await fetchImpl(buildRouteUrl(routeId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(route),
    });

    if (!response.ok) {
      throw new Error(await buildCaddyErrorMessage("apply", routeId, response));
    }
  }

  async function deleteRoute(routeId: string): Promise<void> {
    const response = await fetchImpl(buildRouteUrl(routeId), { method: "DELETE" });

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(await buildCaddyErrorMessage("delete", routeId, response));
    }
  }

  return { applyRoute, deleteRoute };
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
    return (await response.text()).trim();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return `unable to read response body: ${error.message}`;
    }

    return "unable to read response body";
  }
}
