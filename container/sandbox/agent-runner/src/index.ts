import Fastify, { type FastifyInstance } from "fastify";
import type { BuildServerOptions } from "./types.js";

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  void opts;
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.get("/healthz", async () => ({ ok: true }));
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
