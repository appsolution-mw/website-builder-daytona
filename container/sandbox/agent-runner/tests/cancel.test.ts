import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/index.js";
import { signRequest } from "../src/hmac.js";

describe("/claude-sdk/cancel", () => {
  const secret = "s";
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer({ hmacSecret: secret });
  });
  afterAll(async () => {
    await app.close();
  });

  function signedHeaders(body: string) {
    const ts = Date.now().toString();
    const sig = signRequest({ body, ts, secret });
    return { "content-type": "application/json", "x-runner-ts": ts, "x-runner-sig": sig };
  }

  it("returns 401 without signature", async () => {
    const res = await app.inject({ method: "POST", url: "/claude-sdk/cancel/foo" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with bad signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/claude-sdk/cancel/foo",
      headers: {
        "content-type": "application/json",
        "x-runner-ts": Date.now().toString(),
        "x-runner-sig": "deadbeef",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when not in flight", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/claude-sdk/cancel/foo",
      headers: signedHeaders(""),
    });
    expect(res.statusCode).toBe(404);
  });

  it("aborts and returns 200 when in flight", async () => {
    const map = app.inFlight;
    const ac = new AbortController();
    map.set("p1", { abort: ac, startedAt: Date.now() });
    const res = await app.inject({
      method: "POST",
      url: "/claude-sdk/cancel/p1",
      headers: signedHeaders(""),
    });
    expect(res.statusCode).toBe(200);
    expect(ac.signal.aborted).toBe(true);
    expect(map.has("p1")).toBe(false);
  });
});
