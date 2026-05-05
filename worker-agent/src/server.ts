import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { DockerClient, SandboxSpec } from "./docker.js";
import { verify } from "./hmac.js";
import type {
  BrokerCommandResponse,
  CancelProjectRunRequest,
  CreateSandboxRequest,
  CreateSandboxResponse,
  DrainProjectQueueRequest,
  ErrorResponse,
  ExecuteProjectRunRequest,
  GitStatusRequest,
  HealthResponse,
  PushProjectGitChangesRequest,
  SandboxStatusResponse,
} from "./types.js";

export interface BuildServerArgs {
  docker: DockerClient;
  hmacSecret: string;
  brokerContainerPort: number;
  previewContainerPort: number;
  dockerVersion?: string;
}

export async function buildServer(args: BuildServerArgs): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const startedAt = Date.now();
  const brokerTokens = new Map<string, string>();

  // Override the default JSON parser to allow empty bodies (DELETE/GET requests
  // may send Content-Type: application/json with no body; Fastify v5 rejects
  // empty JSON bodies by default with FST_ERR_CTP_EMPTY_JSON_BODY).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      const bodyText = typeof body === "string" ? body : body.toString("utf8");
      if (bodyText.trim() === "") {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(bodyText));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Capture raw body for HMAC verification, then re-emit as a stream so
  // Fastify's content-type parser still gets a readable input.
  app.addHook("preParsing", async (req, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const c of payload) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    (req as FastifyRequest & { rawBody: string }).rawBody = raw;
    return Readable.from([Buffer.from(raw)]);
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/health") return;
    const ts = req.headers["x-timestamp"];
    const sig = req.headers["x-signature"];
    if (typeof ts !== "string" || typeof sig !== "string") {
      return reply.code(401).send({ error: "missing-hmac-headers" } satisfies ErrorResponse);
    }
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    const result = verify({
      secret: args.hmacSecret,
      timestamp: ts,
      method: req.method,
      path: req.url.split("?")[0],
      body: raw,
      signature: sig,
      now: new Date(),
    });
    if (!result.ok) {
      return reply.code(401).send({ error: "hmac-invalid", reason: result.reason } satisfies ErrorResponse);
    }
  });

  app.get("/health", async (): Promise<HealthResponse> => {
    const list = await args.docker.listSandboxes();
    return {
      ok: true,
      dockerVersion: args.dockerVersion ?? "unknown",
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      count: list.length,
    };
  });

  app.post("/sandboxes", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CreateSandboxRequest;
    if (!body || typeof body.sandboxId !== "string" || typeof body.image !== "string") {
      return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
    }
    const spec: SandboxSpec = {
      sandboxId: body.sandboxId,
      projectId: body.projectId,
      image: body.image,
      env: { ...body.env, BROKER_TOKEN: body.brokerToken },
      brokerContainerPort: args.brokerContainerPort,
      previewContainerPort: args.previewContainerPort,
    };
    try {
      const created = await args.docker.createSandbox(spec);
      brokerTokens.set(created.sandboxId, body.brokerToken);
      const res: CreateSandboxResponse = {
        sandboxId: created.sandboxId,
        containerId: created.containerId,
        brokerPort: created.brokerPort,
        previewPort: created.previewPort,
        status: "spawning",
      };
      return reply.code(201).send(res);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode === 404 || /No such image/i.test(e.message)) {
        return reply.code(422).send({ error: "image-not-found", reason: e.message } satisfies ErrorResponse);
      }
      if (/exhaust/i.test(e.message)) {
        return reply.code(503).send({ error: "port-exhausted" } satisfies ErrorResponse);
      }
      console.error("createSandbox failed", err);
      return reply.code(500).send({ error: "internal", reason: e.message } satisfies ErrorResponse);
    }
  });

  app.delete<{ Params: { id: string } }>("/sandboxes/:id", async (req, reply) => {
    await args.docker.destroySandbox(req.params.id);
    brokerTokens.delete(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string }; Reply: SandboxStatusResponse }>("/sandboxes/:id", async (req) => {
    return await args.docker.getStatus(req.params.id);
  });

  app.get<{ Reply: SandboxStatusResponse[] }>("/sandboxes", async () => {
    return await args.docker.listSandboxes();
  });

  app.post<{ Params: { id: string } }>(
    "/sandboxes/:id/queue/drain",
    async (req, reply) => {
      const body = req.body as DrainProjectQueueRequest | undefined;
      if (!body || typeof body.projectId !== "string" || body.projectId.length === 0) {
        return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
      }
      const result = await forwardBrokerCommand({
        sandboxId: req.params.id,
        brokerTokens,
        docker: args.docker,
        path: `/internal/projects/${encodeURIComponent(body.projectId)}/queue/drain`,
      });
      return sendBrokerCommandResult(reply, result);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sandboxes/:id/git/status",
    async (req, reply) => {
      const body = req.body as GitStatusRequest | undefined;
      if (!body || typeof body.projectId !== "string" || body.projectId.length === 0) {
        return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
      }
      const result = await forwardBrokerCommand({
        sandboxId: req.params.id,
        brokerTokens,
        docker: args.docker,
        path: `/internal/projects/${encodeURIComponent(body.projectId)}/git/status`,
      });
      return sendBrokerCommandResult(reply, result);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/sandboxes/:id/git/push",
    async (req, reply) => {
      const body = req.body as PushProjectGitChangesRequest | undefined;
      if (!isPushProjectGitChangesRequest(body)) {
        return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
      }
      const result = await forwardBrokerCommand({
        sandboxId: req.params.id,
        brokerTokens,
        docker: args.docker,
        path: `/internal/projects/${encodeURIComponent(body.projectId)}/git/push`,
        body: {
          remoteUrl: body.remoteUrl,
          ...(body.remoteAuth ? { remoteAuth: body.remoteAuth } : {}),
          branch: body.branch,
          commitMessage: body.commitMessage,
        },
      });
      return sendBrokerCommandResult(reply, result);
    },
  );

  app.post<{ Params: { id: string; runId: string } }>(
    "/sandboxes/:id/runs/:runId/execute",
    async (req, reply) => {
      const body = req.body as ExecuteProjectRunRequest | undefined;
      if (!isExecuteProjectRunRequest(body) || body.runId !== req.params.runId) {
        return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
      }

      const result = await forwardBrokerCommandStream({
        sandboxId: req.params.id,
        brokerTokens,
        docker: args.docker,
        path: `/internal/projects/${encodeURIComponent(body.projectId)}/runs/${encodeURIComponent(body.runId)}/execute`,
        body,
      });
      if (!result.ok) {
        return reply
          .code(result.statusCode)
          .send({
            error: result.error,
            ...(result.reason ? { reason: result.reason } : {}),
          } satisfies ErrorResponse);
      }

      reply.header("content-type", result.contentType);
      return reply.send(result.stream);
    },
  );

  app.post<{ Params: { id: string; runId: string } }>(
    "/sandboxes/:id/runs/:runId/cancel",
    async (req, reply) => {
      const body = req.body as CancelProjectRunRequest | undefined;
      if (
        !body ||
        typeof body.projectId !== "string" ||
        body.projectId.length === 0 ||
        typeof body.runId !== "string" ||
        body.runId.length === 0
      ) {
        return reply.code(400).send({ error: "bad-request" } satisfies ErrorResponse);
      }
      if (body.runId !== req.params.runId) {
        return reply.code(400).send({ error: "run-id-mismatch" } satisfies ErrorResponse);
      }
      const result = await forwardBrokerCommand({
        sandboxId: req.params.id,
        brokerTokens,
        docker: args.docker,
        path: `/internal/projects/${encodeURIComponent(body.projectId)}/runs/${encodeURIComponent(body.runId)}/cancel`,
      });
      return sendBrokerCommandResult(reply, result);
    },
  );

  return app;
}

type BrokerCommandResult =
  | { ok: true; body: BrokerCommandResponse }
  | { ok: false; statusCode: number; error: string; reason?: string };

type BrokerCommandStreamResult =
  | { ok: true; stream: Readable; contentType: string }
  | { ok: false; statusCode: number; error: string; reason?: string };

async function forwardBrokerCommand(args: {
  sandboxId: string;
  brokerTokens: Map<string, string>;
  docker: DockerClient;
  path: string;
  body?: unknown;
}): Promise<BrokerCommandResult> {
  const token = args.brokerTokens.get(args.sandboxId);
  if (!token) {
    return { ok: false, statusCode: 409, error: "broker-token-missing" };
  }

  const status = await args.docker.getStatus(args.sandboxId);
  if (status.status !== "running") {
    return { ok: false, statusCode: 409, error: "sandbox-not-running" };
  }
  if (typeof status.brokerPort !== "number") {
    return { ok: false, statusCode: 409, error: "broker-port-missing" };
  }

  let response: Response;
  const rawBody = args.body === undefined ? undefined : JSON.stringify(args.body);
  try {
    response = await fetch(`http://127.0.0.1:${status.brokerPort}${args.path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(rawBody ? { "content-type": "application/json" } : {}),
      },
      ...(rawBody ? { body: rawBody } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      statusCode: 502,
      error: "broker-command-failed",
      reason: err instanceof Error ? err.message : "network-error",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      statusCode: 502,
      error: "broker-command-failed",
      reason: `${response.status}`,
    };
  }

  const parsed = await parseBrokerCommandResponse(response);
  return { ok: true, body: parsed };
}

async function forwardBrokerCommandStream(args: {
  sandboxId: string;
  brokerTokens: Map<string, string>;
  docker: DockerClient;
  path: string;
  body: unknown;
}): Promise<BrokerCommandStreamResult> {
  const token = args.brokerTokens.get(args.sandboxId);
  if (!token) {
    return { ok: false, statusCode: 409, error: "broker-token-missing" };
  }

  const status = await args.docker.getStatus(args.sandboxId);
  if (status.status !== "running") {
    return { ok: false, statusCode: 409, error: "sandbox-not-running" };
  }
  if (typeof status.brokerPort !== "number") {
    return { ok: false, statusCode: 409, error: "broker-port-missing" };
  }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${status.brokerPort}${args.path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.body),
    });
  } catch (err) {
    return {
      ok: false,
      statusCode: 502,
      error: "broker-command-failed",
      reason: err instanceof Error ? err.message : "network-error",
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      statusCode: 502,
      error: "broker-command-failed",
      reason: `${response.status}`,
    };
  }

  return {
    ok: true,
    stream: Readable.fromWeb(response.body as unknown as NodeReadableStream),
    contentType: response.headers.get("content-type") ?? "application/x-ndjson",
  };
}

async function parseBrokerCommandResponse(response: Response): Promise<BrokerCommandResponse> {
  const text = await response.text();
  if (!text) {
    return { ok: true };
  }
  try {
    const parsed = JSON.parse(text) as Partial<BrokerCommandResponse>;
    return typeof parsed.ok === "boolean" ? parsed as BrokerCommandResponse : { ok: true };
  } catch {
    return { ok: true };
  }
}

function sendBrokerCommandResult(
  reply: FastifyReply,
  result: BrokerCommandResult,
): FastifyReply {
  if (result.ok) {
    return reply.code(200).send(result.body);
  }
  return reply
    .code(result.statusCode)
    .send({
      error: result.error,
      ...(result.reason ? { reason: result.reason } : {}),
    } satisfies ErrorResponse);
}

function isExecuteProjectRunRequest(value: unknown): value is ExecuteProjectRunRequest {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.projectId === "string" &&
    typeof body.sessionId === "string" &&
    typeof body.providerSessionId === "string" &&
    typeof body.runId === "string" &&
    typeof body.attemptId === "string" &&
    typeof body.prompt === "string" &&
    isWorkerAgentRuntime(body.runtime) &&
    typeof body.resumeSession === "boolean" &&
    (body.modelId === undefined || typeof body.modelId === "string")
  );
}

function isPushProjectGitChangesRequest(value: unknown): value is PushProjectGitChangesRequest {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.projectId === "string" &&
    body.projectId.length > 0 &&
    typeof body.remoteUrl === "string" &&
    body.remoteUrl.length > 0 &&
    (
      body.remoteAuth === undefined ||
      (
        typeof body.remoteAuth === "object" &&
        body.remoteAuth !== null &&
        typeof (body.remoteAuth as Record<string, unknown>).username === "string" &&
        typeof (body.remoteAuth as Record<string, unknown>).password === "string"
      )
    ) &&
    typeof body.branch === "string" &&
    body.branch.length > 0 &&
    typeof body.commitMessage === "string" &&
    body.commitMessage.length > 0
  );
}

function isWorkerAgentRuntime(value: unknown): value is ExecuteProjectRunRequest["runtime"] {
  return (
    value === "claude-code" ||
    value === "openai-codex" ||
    value === "vercel-ai" ||
    value === "openhands"
  );
}
