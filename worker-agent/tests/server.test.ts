import { describe, expect, it, beforeEach } from "vitest";
import { sign } from "../src/hmac.js";
import { buildServer } from "../src/server.js";
import type {
  CreatedSandbox,
  DockerClient,
  SandboxStatusInfo,
  SandboxSpec,
} from "../src/docker.js";

const SECRET = "test-secret-32-chars-minimum-please";

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
    app = await buildServer({
      docker: fakeDocker(),
      hmacSecret: SECRET,
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    });
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
});
