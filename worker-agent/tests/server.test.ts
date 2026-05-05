import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { sign } from "../src/hmac.js";
import { buildServer } from "../src/server.js";
import type {
  CreatedSandbox,
  DockerClient,
  SandboxStatusInfo,
  SandboxSpec,
} from "../src/docker.js";

const SECRET = "test-secret-32-chars-minimum-please";
let brokerServer: http.Server | undefined;
let brokerRequests: Array<{
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}> = [];

function fakeDocker(): DockerClient {
  const map = new Map<string, SandboxStatusInfo>();
  return {
    async createSandbox(spec: SandboxSpec): Promise<CreatedSandbox> {
      const containerId = `cid-${spec.sandboxId}`;
      const r: CreatedSandbox = {
        sandboxId: spec.sandboxId,
        containerId,
        brokerPort: 33001,
        previewPort: 33002,
        status: "spawning",
      };
      map.set(spec.sandboxId, { ...r, status: "running" });
      return r;
    },
    async destroySandbox(id) { map.delete(id); },
    async getStatus(id) {
      return map.get(id) ?? { sandboxId: id, status: "gone" };
    },
    async listSandboxes() { return [...map.values()]; },
  };
}

function signed(method: string, path: string, body: string) {
  const ts = new Date().toISOString();
  return {
    "x-timestamp": ts,
    "x-signature": sign({ secret: SECRET, timestamp: ts, method, path, body }),
    "content-type": "application/json",
  };
}

describe("worker-agent server", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    brokerRequests = [];
    brokerServer = undefined;
    app = await buildServer({
      docker: fakeDocker(),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
  });

  afterEach(async () => {
    if (brokerServer) {
      await new Promise<void>((resolve) => brokerServer?.close(() => resolve()));
      brokerServer = undefined;
    }
  });

  it("GET /health is unauthenticated and returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
  });

  it("POST /sandboxes without HMAC returns 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/sandboxes",
      payload: JSON.stringify({}), headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /sandboxes with valid HMAC returns 201 + sandbox info", async () => {
    const body = JSON.stringify({
      sandboxId: "s1", projectId: "p1", image: "alpine:3.20",
      env: { TEST: "1" }, brokerToken: "tok",
    });
    const res = await app.inject({
      method: "POST", url: "/sandboxes",
      payload: body, headers: signed("POST", "/sandboxes", body),
    });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.sandboxId).toBe("s1");
    expect(r.containerId).toMatch(/cid-/);
    expect(r.brokerPort).toBeGreaterThan(0);
  });

  it("POST /sandboxes propagates BROKER_TOKEN into env", async () => {
    let captured: SandboxSpec | undefined;
    const docker: DockerClient = {
      ...fakeDocker(),
      async createSandbox(spec) {
        captured = spec;
        return { sandboxId: spec.sandboxId, containerId: "x", brokerPort: 1, previewPort: 2, status: "spawning" };
      },
    };
    const app2 = await buildServer({
      docker, hmacSecret: SECRET,
      brokerContainerPort: 4000, previewContainerPort: 3000,
    });
    const body = JSON.stringify({
      sandboxId: "s2", projectId: "p2", image: "x", env: { A: "1" }, brokerToken: "the-token",
    });
    await app2.inject({ method: "POST", url: "/sandboxes", payload: body, headers: signed("POST", "/sandboxes", body) });
    expect(captured?.env.BROKER_TOKEN).toBe("the-token");
    expect(captured?.env.A).toBe("1");
  });

  it("DELETE /sandboxes/:id returns 204", async () => {
    const post = JSON.stringify({ sandboxId: "s3", projectId: "p", image: "x", env: {}, brokerToken: "t" });
    await app.inject({ method: "POST", url: "/sandboxes", payload: post, headers: signed("POST", "/sandboxes", post) });
    const res = await app.inject({
      method: "DELETE", url: "/sandboxes/s3",
      headers: signed("DELETE", "/sandboxes/s3", ""),
    });
    expect(res.statusCode).toBe(204);
  });

  it("DELETE /sandboxes/:id is idempotent (also 204 on unknown)", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/sandboxes/nope",
      headers: signed("DELETE", "/sandboxes/nope", ""),
    });
    expect(res.statusCode).toBe(204);
  });

  it("GET /sandboxes/:id returns status", async () => {
    const post = JSON.stringify({ sandboxId: "s4", projectId: "p", image: "x", env: {}, brokerToken: "t" });
    await app.inject({ method: "POST", url: "/sandboxes", payload: post, headers: signed("POST", "/sandboxes", post) });
    const res = await app.inject({
      method: "GET", url: "/sandboxes/s4", headers: signed("GET", "/sandboxes/s4", ""),
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.status).toBe("running");
  });

  it("GET /sandboxes lists all", async () => {
    for (const id of ["s5", "s6"]) {
      const post = JSON.stringify({ sandboxId: id, projectId: "p", image: "x", env: {}, brokerToken: "t" });
      await app.inject({ method: "POST", url: "/sandboxes", payload: post, headers: signed("POST", "/sandboxes", post) });
    }
    const res = await app.inject({ method: "GET", url: "/sandboxes", headers: signed("GET", "/sandboxes", "") });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBe(2);
  });

  it("POST /sandboxes returns 422 if docker layer reports image-not-found", async () => {
    const docker: DockerClient = {
      ...fakeDocker(),
      async createSandbox() {
        const e = new Error("No such image: ghcr.io/nope:latest") as Error & { statusCode?: number };
        e.statusCode = 404;
        throw e;
      },
    };
    const app2 = await buildServer({
      docker, hmacSecret: SECRET,
      brokerContainerPort: 4000, previewContainerPort: 3000,
    });
    const body = JSON.stringify({ sandboxId: "s7", projectId: "p", image: "x", env: {}, brokerToken: "t" });
    const res = await app2.inject({ method: "POST", url: "/sandboxes", payload: body, headers: signed("POST", "/sandboxes", body) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("image-not-found");
  });

  it("POST /sandboxes/:id/queue/drain without HMAC returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: JSON.stringify({ projectId: "p1" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /sandboxes/:id/queue/drain forwards to broker with bearer token", async () => {
    const { port } = await startBrokerCommandServer(200, { ok: true });
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running", brokerPort: port }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({ projectId: "p1" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/queue/drain", body),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(brokerRequests).toEqual([
      {
        method: "POST",
        url: "/internal/projects/p1/queue/drain",
        authorization: "Bearer broker-token",
        body: "",
      },
    ]);
  });

  it("POST /sandboxes/:id/runs/:runId/cancel validates body run id consistency", async () => {
    const { port } = await startBrokerCommandServer(200, { ok: true });
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running", brokerPort: port }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({ projectId: "p1", runId: "other-run" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/runs/run-1/cancel",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/runs/run-1/cancel", body),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("run-id-mismatch");
    expect(brokerRequests).toEqual([]);
  });

  it("POST /sandboxes/:id/runs/:runId/execute forwards the request and streams broker events", async () => {
    const { port } = await startBrokerStreamServer([
      { type: "agent.chunk", turnId: "run-1", delta: "Hi" },
      { type: "agent.done", turnId: "run-1", exitCode: 0 },
    ]);
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running", brokerPort: port }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({
      projectId: "p1",
      sessionId: "session-1",
      providerSessionId: "provider-1",
      runId: "run-1",
      attemptId: "attempt-1",
      prompt: "Build it",
      runtime: "openhands",
      resumeSession: true,
    });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/runs/run-1/execute",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/runs/run-1/execute", body),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.body.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "agent.chunk", turnId: "run-1", delta: "Hi" },
      { type: "agent.done", turnId: "run-1", exitCode: 0 },
    ]);
    expect(brokerRequests).toEqual([
      {
        method: "POST",
        url: "/internal/projects/p1/runs/run-1/execute",
        authorization: "Bearer broker-token",
        body,
      },
    ]);
  });

  it("POST /sandboxes/:id/queue/drain validates projectId body", async () => {
    const body = JSON.stringify({});

    const res = await app.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/queue/drain", body),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("bad-request");
  });

  it("POST /sandboxes/:id/queue/drain requires a broker port", async () => {
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running" }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({ projectId: "p1" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/queue/drain", body),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("broker-port-missing");
  });

  it("POST /sandboxes/:id/queue/drain refuses non-running sandboxes without contacting broker", async () => {
    const { port } = await startBrokerCommandServer(200, { ok: true });
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "stopped", brokerPort: port }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({ projectId: "p1" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/queue/drain", body),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("sandbox-not-running");
    expect(brokerRequests).toEqual([]);
  });

  it("POST /sandboxes/:id/runs/:runId/cancel reports broker failure", async () => {
    const { port } = await startBrokerCommandServer(503, { error: "busy" });
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running", brokerPort: port }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    await createSandbox(app2, "s1", "p1", "broker-token");
    const body = JSON.stringify({ projectId: "p1", runId: "run-1" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/runs/run-1/cancel",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/runs/run-1/cancel", body),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: "broker-command-failed",
      reason: "503",
    });
  });

  it("POST /sandboxes/:id/queue/drain returns 409 when the broker token is missing", async () => {
    const app2 = await buildServer({
      docker: dockerWithStatus({ sandboxId: "s1", status: "running", brokerPort: 33001 }),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
    const body = JSON.stringify({ projectId: "p1" });

    const res = await app2.inject({
      method: "POST",
      url: "/sandboxes/s1/queue/drain",
      payload: body,
      headers: signed("POST", "/sandboxes/s1/queue/drain", body),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("broker-token-missing");
  });
});

async function createSandbox(
  app: Awaited<ReturnType<typeof buildServer>>,
  sandboxId: string,
  projectId: string,
  brokerToken: string,
): Promise<void> {
  const body = JSON.stringify({
    sandboxId,
    projectId,
    image: "x",
    env: {},
    brokerToken,
  });
  const res = await app.inject({
    method: "POST",
    url: "/sandboxes",
    payload: body,
    headers: signed("POST", "/sandboxes", body),
  });
  expect(res.statusCode).toBe(201);
}

function dockerWithStatus(status: SandboxStatusInfo): DockerClient {
  return {
    ...fakeDocker(),
    async createSandbox(spec) {
      return {
        sandboxId: spec.sandboxId,
        containerId: "cid-command",
        brokerPort: status.brokerPort ?? 33001,
        previewPort: status.previewPort ?? 33002,
        status: "spawning",
      };
    },
    async getStatus(id) {
      return id === status.sandboxId ? status : { sandboxId: id, status: "gone" };
    },
  };
}

async function startBrokerCommandServer(
  statusCode: number,
  responseBody: unknown,
): Promise<{ port: number }> {
  brokerServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      brokerRequests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(statusCode, { "content-type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => brokerServer?.listen(0, "127.0.0.1", resolve));
  const address = brokerServer.address();
  if (!address || typeof address === "string") {
    throw new Error("broker test server did not bind to a port");
  }
  return { port: address.port };
}

async function startBrokerStreamServer(events: unknown[]): Promise<{ port: number }> {
  brokerServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      brokerRequests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const event of events) {
        res.write(`${JSON.stringify(event)}\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => brokerServer?.listen(0, "127.0.0.1", resolve));
  const address = brokerServer.address();
  if (!address || typeof address === "string") {
    throw new Error("broker test server did not bind to a port");
  }
  return { port: address.port };
}
