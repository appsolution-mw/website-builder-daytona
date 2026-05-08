import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/index.js";

describe("agent-runner /healthz", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildServer({ hmacSecret: "x" });
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns 200 ok", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
