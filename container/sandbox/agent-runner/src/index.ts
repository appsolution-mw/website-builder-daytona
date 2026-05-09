import Fastify, { type FastifyInstance } from "fastify";
import type { BuildServerOptions, InFlightTurn, TurnRequest } from "./types.js";
import { verifyRequest } from "./hmac.js";
import { runTurn } from "./sdk-runner.js";
import { mergeAgentContext } from "./bootstrap-merge.js";

const HMAC_MAX_AGE_MS = 60_000;

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  // Custom JSON parser: retain raw body so the HMAC pre-handler can verify it.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const raw = (body as string) ?? "";
        const parsed = raw.length === 0 ? {} : JSON.parse(raw);
        done(null, { __raw: raw, parsed });
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // HMAC verification for everything except GET /healthz.
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" && req.url === "/healthz") return;
    const ts = req.headers["x-runner-ts"];
    const sig = req.headers["x-runner-sig"];
    if (typeof ts !== "string" || typeof sig !== "string") {
      return reply.code(401).send({ error: "missing signature" });
    }
    const body = (req.body as { __raw?: string } | undefined)?.__raw ?? "";
    if (!verifyRequest({ body, ts, sig, secret: opts.hmacSecret, maxAgeMs: HMAC_MAX_AGE_MS })) {
      return reply.code(401).send({ error: "bad signature" });
    }
    // Replace req.body with the parsed payload so downstream handlers don't see __raw.
    (req as unknown as { body: unknown }).body = (req.body as { parsed?: unknown }).parsed;
  });

  // In-flight turn map: consumed by future POST /claude-sdk/turn (Task 5)
  // and by the cancel endpoint below.
  const inFlight = new Map<string, InFlightTurn>();
  app.decorate("inFlight", inFlight);

  app.get("/healthz", async () => ({ ok: true }));

  let bootstrapped = false;
  app.post("/claude-sdk/bootstrap", async () => {
    if (bootstrapped) return { ok: true, alreadyDone: true };
    await mergeAgentContext({
      defaultsDir: opts.agentContextDir ?? "/opt/agent-context",
      workspaceDir: opts.workspaceDir ?? "/workspace",
    });
    bootstrapped = true;
    return { ok: true };
  });

  app.post<{ Params: { providerSessionId: string } }>(
    "/claude-sdk/cancel/:providerSessionId",
    async (req, reply) => {
      const { providerSessionId } = req.params;
      const entry = inFlight.get(providerSessionId);
      if (!entry) return reply.code(404).send({ error: "not in flight" });
      entry.abort.abort();
      inFlight.delete(providerSessionId);
      return { ok: true };
    },
  );

  app.post("/claude-sdk/turn", async (req, reply) => {
    // preHandler unwraps __raw/parsed; body is now TurnRequest
    const body = req.body as unknown as TurnRequest;

    if (inFlight.has(body.providerSessionId)) {
      return reply.code(409).send({ error: "already in flight" });
    }
    const abort = new AbortController();
    inFlight.set(body.providerSessionId, { abort, startedAt: Date.now() });

    // Order matters: hijack first, set statusCode BEFORE flushHeaders so Node
    // commits the intended status (default would silently win otherwise).
    // setHeader works equivalently before/after hijack; flushHeaders commits.
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "application/x-ndjson");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    const flushHeaders = (reply.raw as { flushHeaders?: () => void }).flushHeaders;
    if (typeof flushHeaders === "function") flushHeaders.call(reply.raw);

    const emit = (ev: unknown): void => {
      reply.raw.write(`${JSON.stringify(ev)}\n`);
    };

    try {
      await runTurn(body, {
        workspaceDir: opts.workspaceDir ?? "/workspace",
        abort,
        runtime: "claude-code",
        emit,
        // Task 8 will inject real PreToolUse/PostToolUse policy hooks.
        buildHooks: () => ({}),
      });
    } catch (err) {
      emit({
        type: "agent.error",
        turnId: body.turnId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight.delete(body.providerSessionId);
      reply.raw.end();
    }
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.AGENT_RUNNER_HMAC_SECRET;
  if (!secret) {
    console.error("AGENT_RUNNER_HMAC_SECRET required");
    process.exit(1);
  }
  const app = await buildServer({ hmacSecret: secret });
  const port = Number(process.env.AGENT_RUNNER_PORT ?? "7050");
  await app.listen({ host: "127.0.0.1", port });
}
