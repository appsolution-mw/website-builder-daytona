import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signRequest } from "../src/hmac.js";
import { runTurn } from "../src/sdk-runner.js";
import type { TurnRequest } from "../src/types.js";
import type { BrokerToHost } from "@wbd/protocol";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

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

  it("fallback runs when resume returns a different session id and emits two agent.session events", async () => {
    let callCount = 0;
    const fakeQuery = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const iter = (async function* () {
          yield { type: "system", subtype: "init", session_id: "different-session", model: "m" };
          // Would yield more events, but the runner detects the resume mismatch
          // on the system.init above, calls interrupt(), and breaks out of the
          // loop before consuming further yields.
          yield {
            type: "stream_event",
            event: { type: "content_block_delta", delta: { type: "text_delta", text: "ignored" } },
          };
        })() as AsyncGenerator<unknown, void> & { interrupt?: () => Promise<void> };
        iter.interrupt = vi.fn().mockResolvedValue(undefined);
        return iter;
      }
      const iter = (async function* () {
        yield { type: "system", subtype: "init", session_id: "fresh-session", model: "m" };
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } },
        };
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      })() as AsyncGenerator<unknown, void> & { interrupt?: () => Promise<void> };
      iter.interrupt = vi.fn().mockResolvedValue(undefined);
      return iter;
    });

    const events: BrokerToHost[] = [];
    const abort = new AbortController();
    await runTurn(
      makeReq({
        providerSessionId: "requested-id",
        resumeRequested: true,
        prompt: "current",
        replayContext: [
          { role: "user", text: "earlier" },
          { role: "assistant", text: "reply" },
        ],
      }),
      {
        workspaceDir: "/w",
        abort,
        runtime: "claude-code",
        emit: (e) => {
          events.push(e);
        },
        buildHooks: () => ({}),
        query: fakeQuery as never,
      },
    );

    const sessions = events.filter(
      (e): e is Extract<BrokerToHost, { type: "agent.session" }> => e.type === "agent.session",
    );
    expect(sessions.length).toBe(2);
    expect(sessions[0]).toMatchObject({ providerSessionId: "different-session", resumed: false });
    expect(sessions[1]).toMatchObject({ providerSessionId: "fresh-session" });
    expect("resumed" in sessions[1]).toBe(false);
    const chunk = events.find(
      (e): e is Extract<BrokerToHost, { type: "agent.chunk" }> => e.type === "agent.chunk",
    );
    expect(chunk?.delta).toBe("ok");
    expect(events.find((e) => e.type === "agent.done")).toBeTruthy();

    // Second SDK call should have received a prompt augmented with replay context
    expect(fakeQuery).toHaveBeenCalledTimes(2);
    const secondCallArgs = fakeQuery.mock.calls[1][0] as { prompt: string; options: Options };
    expect(secondCallArgs.prompt).toContain("[Previous conversation]");
    expect(secondCallArgs.prompt).toContain("user: earlier");
    expect(secondCallArgs.prompt).toContain("assistant: reply");
    expect(secondCallArgs.prompt).toContain("[Current message]");
    expect(secondCallArgs.prompt).toContain("current");
    expect(secondCallArgs.options.resume).toBeUndefined();
  });

  it("does not run fallback when resume succeeds (session ids match)", async () => {
    const fakeQuery = vi.fn().mockImplementation(() => {
      const iter = (async function* () {
        yield { type: "system", subtype: "init", session_id: "matching-id", model: "m" };
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })() as AsyncGenerator<unknown, void> & { interrupt?: () => Promise<void> };
      iter.interrupt = vi.fn().mockResolvedValue(undefined);
      return iter;
    });

    const events: BrokerToHost[] = [];
    await runTurn(
      makeReq({
        providerSessionId: "matching-id",
        resumeRequested: true,
        prompt: "p",
        replayContext: [{ role: "user", text: "x" }],
      }),
      {
        workspaceDir: "/w",
        abort: new AbortController(),
        runtime: "claude-code",
        emit: (e) => {
          events.push(e);
        },
        buildHooks: () => ({}),
        query: fakeQuery as never,
      },
    );

    expect(fakeQuery).toHaveBeenCalledTimes(1);
    const sessions = events.filter(
      (e): e is Extract<BrokerToHost, { type: "agent.session" }> => e.type === "agent.session",
    );
    expect(sessions.length).toBe(1);
    expect(sessions[0]).toMatchObject({ resumed: true });
  });

  it("patches agent.done with OpenRouter cost when ANTHROPIC_BASE_URL is openrouter.ai", async () => {
    const original = {
      base: process.env.ANTHROPIC_BASE_URL,
      key: process.env.OPENROUTER_API_KEY,
    };
    process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";

    try {
      const messages = [
        { type: "system", subtype: "init", session_id: "sdk-sess-1", model: "claude" },
        {
          type: "assistant",
          message: {
            id: "gen-a",
            content: [{ type: "tool_use", name: "Read", input: { path: "x" } }],
          },
        },
        { type: "assistant", message: { id: "gen-b", content: [{ type: "text", text: "ok" }] } },
        {
          type: "result",
          subtype: "success",
          duration_ms: 100,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      ];

      const fetchFn = vi
        .fn()
        .mockImplementation(async (url: string) => {
          if (typeof url === "string" && url.includes("id=gen-a")) {
            return new Response(
              JSON.stringify({
                data: {
                  id: "gen-a",
                  total_cost: 0.01,
                  native_tokens_prompt: 100,
                  native_tokens_completion: 50,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          if (typeof url === "string" && url.includes("id=gen-b")) {
            return new Response(
              JSON.stringify({
                data: {
                  id: "gen-b",
                  total_cost: 0.02,
                  native_tokens_prompt: 200,
                  native_tokens_completion: 75,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          throw new Error(`unexpected url: ${url}`);
        });

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
        query: fakeQueryFactory(messages) as never,
        __testFetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      const done = events.find(
        (e): e is Extract<BrokerToHost, { type: "agent.done" }> => e.type === "agent.done",
      );
      expect(done).toBeDefined();
      expect(done?.costUsd).toBeCloseTo(0.03, 6);
      expect(done?.tokensIn).toBe(300);
      expect(done?.tokensOut).toBe(125);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      if (original.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = original.base;
      if (original.key === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = original.key;
    }
  });

  it("does NOT patch agent.done when ANTHROPIC_BASE_URL is anthropic.com", async () => {
    const original = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    try {
      const messages = [
        { type: "system", subtype: "init", session_id: "sdk-sess-1", model: "claude" },
        {
          type: "assistant",
          message: {
            id: "msg_abc",
            content: [{ type: "tool_use", name: "Read", input: {} }],
          },
        },
        {
          type: "result",
          subtype: "success",
          duration_ms: 50,
          total_cost_usd: 0.012,
          usage: { input_tokens: 5, output_tokens: 10 },
        },
      ];

      const fetchFn = vi.fn();

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
        query: fakeQueryFactory(messages) as never,
        __testFetch: fetchFn as unknown as typeof globalThis.fetch,
      });

      expect(fetchFn).not.toHaveBeenCalled();
      const done = events.find(
        (e): e is Extract<BrokerToHost, { type: "agent.done" }> => e.type === "agent.done",
      );
      expect(done?.costUsd).toBe(0.012);
      expect(done?.tokensIn).toBe(5);
      expect(done?.tokensOut).toBe(10);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = original;
    }
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
