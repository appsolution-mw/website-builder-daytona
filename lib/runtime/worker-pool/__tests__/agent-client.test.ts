import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import * as http from "node:http";
import { createAgentClient } from "../agent-client";
import { AgentError } from "../types";

const SECRET = "agent-secret-32-chars-min-please";

interface CapturedReq {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe("agent-client", () => {
  let server: http.Server;
  let captured: CapturedReq[] = [];
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  beforeEach(async () => {
    captured = [];
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        captured.push({
          method: req.method!, url: req.url!, headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        respond(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function client() {
    const addr = server.address() as { port: number };
    return createAgentClient({ baseUrl: `http://127.0.0.1:${addr.port}`, hmacSecret: SECRET });
  }

  it("createSandbox sends HMAC-signed POST and parses 201 response", async () => {
    respond = (_req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({
        sandboxId: "s1", containerId: "c1", brokerPort: 33001, previewPort: 33002, status: "spawning",
      }));
    };
    const c = client();
    const r = await c.createSandbox({
      sandboxId: "s1", projectId: "p1", image: "x", env: {}, brokerToken: "t",
    });
    expect(r.containerId).toBe("c1");
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/sandboxes");
    expect(captured[0].headers["x-timestamp"]).toBeTruthy();
    expect(captured[0].headers["x-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("createSandbox throws AgentError(401) on auth failure", async () => {
    respond = (_req, res) => { res.writeHead(401); res.end(JSON.stringify({ error: "hmac-invalid" })); };
    const c = client();
    await expect(c.createSandbox({
      sandboxId: "x", projectId: "x", image: "x", env: {}, brokerToken: "x",
    })).rejects.toThrow(AgentError);
  });

  it("createSandbox throws AgentError(422) for image-not-found", async () => {
    respond = (_req, res) => { res.writeHead(422); res.end(JSON.stringify({ error: "image-not-found" })); };
    const c = client();
    await expect(c.createSandbox({
      sandboxId: "x", projectId: "x", image: "x", env: {}, brokerToken: "x",
    })).rejects.toMatchObject({ statusCode: 422, errorCode: "image-not-found" });
  });

  it("destroySandbox sends DELETE without body", async () => {
    respond = (_req, res) => { res.writeHead(204); res.end(); };
    const c = client();
    await c.destroySandbox("s1");
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url).toBe("/sandboxes/s1");
    expect(captured[0].body).toBe("");
  });

  it("drainProjectQueue sends an HMAC-signed project command", async () => {
    respond = (_req, res) => { res.writeHead(204); res.end(); };
    const c = client();

    await c.drainProjectQueue("sandbox/1", "project-1");

    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/sandboxes/sandbox%2F1/queue/drain");
    expect(captured[0].body).toBe(JSON.stringify({ projectId: "project-1" }));
    expect(captured[0].headers["x-signature"]).toBe(
      signatureFor(captured[0]),
    );
  });

  it("cancelProjectRun sends an HMAC-signed run command", async () => {
    respond = (_req, res) => { res.writeHead(204); res.end(); };
    const c = client();

    await c.cancelProjectRun("sandbox-1", "project-1", "run/1");

    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/sandboxes/sandbox-1/runs/run%2F1/cancel");
    expect(captured[0].body).toBe(JSON.stringify({
      projectId: "project-1",
      runId: "run/1",
    }));
    expect(captured[0].headers["x-signature"]).toBe(
      signatureFor(captured[0]),
    );
  });

  it("executeProjectRun sends an HMAC-signed request and streams NDJSON events", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(`${JSON.stringify({ type: "agent.chunk", turnId: "run-1", delta: "Hi" })}\n`);
      res.end(`${JSON.stringify({ type: "agent.done", turnId: "run-1", exitCode: 0 })}\n`);
    };
    const c = client();
    const events: unknown[] = [];

    await c.executeProjectRun(
      "sandbox-1",
      {
        projectId: "project-1",
        sessionId: "session-1",
        providerSessionId: "provider-1",
        runId: "run-1",
        attemptId: "attempt-1",
        prompt: "Build it",
        runtime: "openhands",
        resumeSession: true,
        modelId: "model-1",
      },
      (event) => {
        events.push(event);
      },
    );

    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("/sandboxes/sandbox-1/runs/run-1/execute");
    expect(JSON.parse(captured[0].body)).toMatchObject({
      projectId: "project-1",
      runId: "run-1",
      runtime: "openhands",
      resumeSession: true,
    });
    expect(captured[0].headers["x-signature"]).toBe(
      signatureFor(captured[0]),
    );
    expect(events).toEqual([
      { type: "agent.chunk", turnId: "run-1", delta: "Hi" },
      { type: "agent.done", turnId: "run-1", exitCode: 0 },
    ]);
  });

  it("getStatus parses status response", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sandboxId: "s1", status: "running" }));
    };
    const c = client();
    const r = await c.getStatus("s1");
    expect(r.status).toBe("running");
  });

  it("rejects on network error with descriptive message", async () => {
    const c = createAgentClient({
      baseUrl: "http://127.0.0.1:1",  // nothing listening
      hmacSecret: SECRET,
      timeoutMs: 200,
    });
    await expect(c.getStatus("s1")).rejects.toThrow();
  });
});

function signatureFor(req: CapturedReq): string {
  const timestamp = req.headers["x-timestamp"];
  if (typeof timestamp !== "string") {
    throw new Error("missing x-timestamp");
  }
  return createHmac("sha256", SECRET)
    .update(`${timestamp}.${req.method}.${req.url}.${req.body}`)
    .digest("hex");
}
