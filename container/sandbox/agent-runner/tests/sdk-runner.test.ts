import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signRequest } from "../src/hmac.js";
import { runTurn } from "../src/sdk-runner.js";
import type { TurnRequest } from "../src/types.js";
import type { BrokerToHost } from "@wbd/protocol";

// Build a fake SDK iterator factory that yields a deterministic stream.
function fakeQueryFactory(messages: unknown[]) {
  const fn = vi.fn().mockImplementation(() => {
    const iter: AsyncGenerator<unknown, void> & { interrupt?: () => Promise<void> } = (async function* () {
      for (const m of messages) yield m;
    })() as AsyncGenerator<unknown, void>;
    iter.interrupt = vi.fn().mockResolvedValue(undefined);
    return iter;
  });
  return fn;
}

const HAPPY_MESSAGES = [
  { type: "system", subtype: "init", session_id: "sdk-sess-1", model: "claude-sonnet-4-6" },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } } },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } } },
  {
    type: "result",
    subtype: "success",
    duration_ms: 100,
    total_cost_usd: 0.001,
    usage: { input_tokens: 5, output_tokens: 10 },
  },
];

function makeReq(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    sessionId: "host-1",
    providerSessionId: "p-1",
    resumeRequested: false,
    prompt: "hi",
    turnId: "t-1",
    ...overrides,
  };
}

describe("runTurn (unit, injected query)", () => {
  it("emits agent.session, agent.chunk*, agent.done in order", async () => {
    const events: BrokerToHost[] = [];
    const abort = new AbortController();
    await runTurn(makeReq(), {
      workspaceDir: "/workspace",
      abort,
      runtime: "claude-code",
      emit: (ev) => {
        events.push(ev);
      },
      buildHooks: () => ({}),
      query: fakeQueryFactory(HAPPY_MESSAGES) as never,
    });

    const session = events.find((e) => e.type === "agent.session");
    const chunks = events
      .filter((e): e is Extract<BrokerToHost, { type: "agent.chunk" }> => e.type === "agent.chunk")
      .map((e) => e.delta)
      .join("");
    const done = events.find(
      (e): e is Extract<BrokerToHost, { type: "agent.done" }> => e.type === "agent.done",
    );

    expect(session).toBeDefined();
    expect(session && session.type === "agent.session" ? session.providerSessionId : undefined).toBe(
      "sdk-sess-1",
    );
    expect(session && session.type === "agent.session" ? session.runtime : undefined).toBe("claude-code");
    expect(chunks).toBe("Hello world");
    expect(done?.subtype).toBe("success");
    expect(done?.costUsd).toBe(0.001);
  });

  it("naive resume sets resumed=true when sdk session_id matches requested providerSessionId", async () => {
    const events: BrokerToHost[] = [];
    await runTurn(makeReq({ providerSessionId: "sdk-sess-1", resumeRequested: true }), {
      workspaceDir: "/workspace",
      abort: new AbortController(),
      runtime: "claude-code",
      emit: (ev) => {
        events.push(ev);
      },
      buildHooks: () => ({}),
      query: fakeQueryFactory(HAPPY_MESSAGES) as never,
    });
    const session = events.find(
      (e): e is Extract<BrokerToHost, { type: "agent.session" }> => e.type === "agent.session",
    );
    expect(session?.resumed).toBe(true);
  });

  it("naive resume sets resumed=false when sdk returns a different session_id", async () => {
    const events: BrokerToHost[] = [];
    await runTurn(makeReq({ providerSessionId: "different", resumeRequested: true }), {
      workspaceDir: "/workspace",
      abort: new AbortController(),
      runtime: "claude-code",
      emit: (ev) => {
        events.push(ev);
      },
      buildHooks: () => ({}),
      query: fakeQueryFactory(HAPPY_MESSAGES) as never,
    });
    const session = events.find(
      (e): e is Extract<BrokerToHost, { type: "agent.session" }> => e.type === "agent.session",
    );
    expect(session?.resumed).toBe(false);
  });

  it("calls iterator.interrupt() when abort fires", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    const queryFn = vi.fn().mockImplementation(() => {
      // Never-ending iterator that yields one chunk then awaits a deferred resolution
      // forever; we abort externally to cut it short.
      const iter = (async function* () {
        yield { type: "system", subtype: "init", session_id: "sdk-sess-1" };
        // Wait until aborted, then return
        await new Promise<void>((resolve) => {
          abort.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      })() as AsyncGenerator<unknown, void> & { interrupt?: () => Promise<void> };
      iter.interrupt = interrupt;
      return iter;
    });
    const abort = new AbortController();
    const events: BrokerToHost[] = [];
    const p = runTurn(makeReq(), {
      workspaceDir: "/workspace",
      abort,
      runtime: "claude-code",
      emit: (ev) => {
        events.push(ev);
      },
      buildHooks: () => ({}),
      query: queryFn as never,
    });
    // Give the loop a tick to start
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    await p;
    expect(interrupt).toHaveBeenCalled();
  });

  it("forwards modelId from SDK system.init onto agent.session", async () => {
    const events: BrokerToHost[] = [];
    await runTurn(makeReq(), {
      workspaceDir: "/workspace",
      abort: new AbortController(),
      runtime: "claude-code",
      emit: (ev) => {
        events.push(ev);
      },
      buildHooks: () => ({}),
      query: fakeQueryFactory(HAPPY_MESSAGES) as never,
    });
    const session = events.find(
      (e): e is Extract<BrokerToHost, { type: "agent.session" }> => e.type === "agent.session",
    );
    expect(session?.modelId).toBe("claude-sonnet-4-6");
  });
});

describe("/claude-sdk/turn HTTP route", () => {
  const secret = "s";
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import("../src/index.js");
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

  it("requires HMAC signature", async () => {
    const body = JSON.stringify({
      providerSessionId: "p",
      prompt: "hi",
      turnId: "t",
      resumeRequested: false,
      sessionId: "h",
    });
    const res = await app.inject({
      method: "POST",
      url: "/claude-sdk/turn",
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 409 when a turn is already in flight for the same providerSessionId", async () => {
    // Pre-populate inFlight to simulate concurrent turn.
    app.inFlight.set("p-conflict", { abort: new AbortController(), startedAt: Date.now() });
    try {
      const body = JSON.stringify({
        sessionId: "host",
        providerSessionId: "p-conflict",
        resumeRequested: false,
        prompt: "hi",
        turnId: "t-x",
      });
      const res = await app.inject({
        method: "POST",
        url: "/claude-sdk/turn",
        headers: signedHeaders(body),
        payload: body,
      });
      expect(res.statusCode).toBe(409);
    } finally {
      app.inFlight.delete("p-conflict");
    }
  });
});
