import { describe, expect, it } from "vitest";
import { buildProjectPreviewRoute } from "../caddy-config";
import { createCaddyClient } from "../caddy-client";

describe("createCaddyClient", () => {
  it("PUTs route JSON to the encoded Caddy admin route path", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 200 });
    };
    const route = buildProjectPreviewRoute({
      hostname: "preview.example.com",
      targetHost: "10.0.0.12",
      targetPort: 3000,
    });

    const client = createCaddyClient("http://127.0.0.1:2019/", fetchImpl);

    await client.applyRoute("project/id", route);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      input: "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes/project%2Fid",
      init: {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(route),
      },
    });
  });

  it("DELETEs the encoded Caddy admin route path and tolerates missing routes", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response("not found", { status: 404 });
    };
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);

    await expect(client.deleteRoute("project/id")).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        input: "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes/project%2Fid",
        init: { method: "DELETE" },
      },
    ]);
  });

  it("throws a useful error when applying a route fails", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("invalid config", { status: 400, statusText: "Bad Request" });
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);
    const route = buildProjectPreviewRoute({
      hostname: "preview.example.com",
      targetHost: "10.0.0.12",
      targetPort: 3000,
    });

    await expect(client.applyRoute("project/id", route)).rejects.toThrow(
      "Failed to apply Caddy route project/id: 400 Bad Request - invalid config",
    );
  });

  it("throws a useful error when deleting a route fails for a non-404 response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("admin unavailable", { status: 503, statusText: "Service Unavailable" });
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);

    await expect(client.deleteRoute("project/id")).rejects.toThrow(
      "Failed to delete Caddy route project/id: 503 Service Unavailable - admin unavailable",
    );
  });
});
