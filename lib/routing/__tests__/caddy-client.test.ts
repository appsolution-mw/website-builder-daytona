import { describe, expect, it } from "vitest";
import { buildProjectPreviewRoute } from "../caddy-config";
import { createCaddyClient } from "../caddy-client";

describe("createCaddyClient", () => {
  it("PATCHes existing routes by encoded Caddy @id", async () => {
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
    expect(callWithoutBody(calls[0])).toEqual({
      input: "http://127.0.0.1:2019/id/project%2Fid",
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
      },
    });
    expect(jsonBody(calls[0])).toEqual({ ...route, "@id": "project/id" });
  });

  it("POSTs a new route to the Caddy routes array when the @id is missing", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      if (calls.length === 1) {
        return new Response("not found", { status: 404 });
      }
      return new Response(null, { status: 200 });
    };
    const route = buildProjectPreviewRoute({
      hostname: "preview.example.com",
      targetHost: "10.0.0.12",
      targetPort: 3000,
    });

    const client = createCaddyClient("http://127.0.0.1:2019/", fetchImpl);

    await client.applyRoute("project/id", route);

    expect(calls.map(callWithoutBody)).toEqual([
      {
        input: "http://127.0.0.1:2019/id/project%2Fid",
        init: {
          method: "PATCH",
          headers: { "content-type": "application/json" },
        },
      },
      {
        input: "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
        },
      },
    ]);
    expect(calls.map(jsonBody)).toEqual([
      { ...route, "@id": "project/id" },
      { ...route, "@id": "project/id" },
    ]);
  });

  it("DELETEs the encoded Caddy @id path and tolerates missing routes", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response("not found", { status: 404 });
    };
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);

    await expect(client.deleteRoute("project/id")).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        input: "http://127.0.0.1:2019/id/project%2Fid",
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

  it("adds operation context when a route network request fails", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:2019");
    };
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);
    const route = buildProjectPreviewRoute({
      hostname: "preview.example.com",
      targetHost: "10.0.0.12",
      targetPort: 3000,
    });

    await expect(client.applyRoute("project/id", route)).rejects.toThrow(
      "Failed to apply Caddy route project/id: connect ECONNREFUSED 127.0.0.1:2019",
    );
  });

  it("redacts sensitive response fields from error bodies", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"token":"secret-value","authorization":"Bearer abc"}', {
        status: 400,
        statusText: "Bad Request",
      });
    const client = createCaddyClient("http://127.0.0.1:2019", fetchImpl);
    const route = buildProjectPreviewRoute({
      hostname: "preview.example.com",
      targetHost: "10.0.0.12",
      targetPort: 3000,
    });

    await expect(client.applyRoute("project/id", route)).rejects.toThrow(
      'Failed to apply Caddy route project/id: 400 Bad Request - {"token":[redacted],"authorization":[redacted]}',
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

function callWithoutBody(call: { input: RequestInfo | URL; init?: RequestInit }): {
  input: RequestInfo | URL;
  init?: Omit<RequestInit, "body">;
} {
  if (!call.init) return call;
  const init = { ...call.init };
  delete init.body;
  return { input: call.input, init };
}

function jsonBody(call: { init?: RequestInit }): unknown {
  const body = call.init?.body;
  if (typeof body !== "string") return null;
  return JSON.parse(body) as unknown;
}
