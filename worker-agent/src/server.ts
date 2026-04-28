import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { Readable } from "node:stream";
import type { DockerClient, SandboxSpec } from "./docker.js";
import { verify } from "./hmac.js";
import type {
  CreateSandboxRequest,
  CreateSandboxResponse,
  ErrorResponse,
  HealthResponse,
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

  // Override the default JSON parser to allow empty bodies (DELETE/GET requests
  // may send Content-Type: application/json with no body; Fastify v5 rejects
  // empty JSON bodies by default with FST_ERR_CTP_EMPTY_JSON_BODY).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      if (!body || body.trim() === "") {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
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
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string }; Reply: SandboxStatusResponse }>("/sandboxes/:id", async (req) => {
    return await args.docker.getStatus(req.params.id);
  });

  app.get<{ Reply: SandboxStatusResponse[] }>("/sandboxes", async () => {
    return await args.docker.listSandboxes();
  });

  return app;
}
