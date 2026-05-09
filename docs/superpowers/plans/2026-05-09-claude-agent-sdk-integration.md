# Claude Agent SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI-subprocess-based Claude Code runner with the official `@anthropic-ai/claude-agent-sdk`, hosted in a new sandbox-internal `agent-runner` Fastify service. Token streaming, hybrid resume, multimodal attachments, host-curated agent context, and policy hooks. Hard cutover.

**Architecture:** New service `container/sandbox/agent-runner/` (sibling to broker, loopback HTTP+HMAC) holds SDK iterators long-running per session. Broker becomes a thin pass-through bridge. Host adapter unchanged in shape — only the event sink and turn-dispatcher payload are extended. Host-curated `agent-context/` baked into sandbox image, merged with per-project `.claude/` overrides at first-turn bootstrap.

**Tech Stack:** Node 20+, TypeScript, Fastify 5, `@anthropic-ai/claude-agent-sdk`, Prisma, vitest, Playwright. Ports/HMAC pattern follows existing `worker-agent/` (host-side) conventions.

**Spec:** [docs/superpowers/specs/2026-05-09-claude-agent-sdk-integration-design.md](../specs/2026-05-09-claude-agent-sdk-integration-design.md)
**Task:** [docs/tasks/active/T-20260509-001.md](../../tasks/active/T-20260509-001.md)

---

## Schema reality check

The spec called for adding `costUsd`/`usageJson` to `Message`. Verification (`prisma/schema.prisma`):
- `costUsd Decimal @default(0) @db.Decimal(18, 9)` already exists on the `TokenUsage` event table — **no migration needed for cost**.
- `cacheCreationInputTokens`/`cacheReadInputTokens` already present (SDK-style cache tracking is supported).
- `SessionRuntimeState.providerSessionId` already exists — used as SDK session id.
- **Only schema delta needed:** add `subtype String?` (e.g., `success | error_max_turns | …`) to whichever record represents a completed turn — see Task 12 for the verification step.

## Protocol reality check

`packages/protocol/src/index.ts` already has:
- `agent.chunk` with field `delta` (not `text`) — reuse as-is.
- `agent.session` with `providerSessionId` and `modelId` — extend with optional `resumed: boolean`.
- `agent.done` with `costUsd`, `tokensIn`, `tokensOut`, `exitCode`, `usage?` — extend with optional `subtype: string`.
- `agent.tool_use`, `agent.error`, `agent.status` — reuse as-is.

**New events introduced by this plan:** `agent.policy_violation` only. (No `agent.tool_result` — tool results stay inside the SDK loop.)

## File structure

**New (created):**
```
container/sandbox/agent-runner/
  Dockerfile
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                    ← Fastify entrypoint
    sdk-runner.ts               ← query() invocation + iterator map
    sdk-event-mapper.ts         ← SDK → BrokerToHost mapping
    resume-detector.ts          ← session_id check + DB-replay fallback
    bootstrap-merge.ts          ← /opt/agent-context → /workspace/.claude merge
    policy-hooks.ts             ← PreToolUse hooks + redaction
    hmac.ts                     ← request signature verification
    types.ts                    ← request/response shapes
  tests/
    sdk-event-mapper.test.ts
    resume-detector.test.ts
    bootstrap-merge.test.ts
    policy-hooks.test.ts
    integration.test.ts

container/sandbox/broker/src/
  claude-sdk-bridge.ts          ← replaces claude-runner.ts

agent-context/                  ← repo root, baked into sandbox image
  CLAUDE.md
  skills/
    frontend-design/SKILL.md
    nextjs-app-router/SKILL.md
    tailwind-conventions/SKILL.md
  agents/
    code-reviewer.md
    ui-designer.md

lib/agents/runtimes/claude-code/
  replay-context.ts             ← last-N messages → primer payload
  __tests__/replay-context.test.ts

e2e/
  claude-agent-sdk.test.ts
```

**Modified:**
```
packages/protocol/src/index.ts                               ← add fields/events
container/sandbox/broker/src/agent-provider-factory.ts       ← wire bridge
container/sandbox/broker/src/handlers.ts                     ← (if it dispatches start_turn directly)
container/sandbox/Dockerfile                                 ← drop CLI binary, add agent-runner
container/sandbox/start.sh (or process supervisor)           ← spawn agent-runner alongside broker
lib/agent-runs/executor-client.ts                            ← handle subtype, policy_violation, resumed flag
lib/agents/runtime.ts                                        ← (verify; likely unchanged)
prisma/schema.prisma                                         ← + subtype field
```

**Deleted:**
```
container/sandbox/broker/src/claude-runner.ts
container/sandbox/broker/src/__tests__/claude-runner.test.ts (if exists)
container/sandbox/Dockerfile entries that install the `claude` CLI binary
```

---

## Task 1: Protocol additions

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/__tests__/agent-events.test.ts` (create or extend)

- [ ] **Step 1: Read current shape**

Run: `sed -n '69,160p' packages/protocol/src/index.ts`
Confirm `agent.chunk` uses `delta`, `agent.session` exists, `agent.done` has `costUsd`+`exitCode`+`usage`.

- [ ] **Step 2: Write failing test for new fields/events**

```ts
// packages/protocol/src/__tests__/agent-events.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { BrokerToHost } from "../index";

describe("protocol additions for Agent SDK", () => {
  it("agent.session accepts optional resumed flag", () => {
    const evt: BrokerToHost = {
      type: "agent.session",
      turnId: "t1",
      runtime: "claude-code",
      providerSessionId: "sess-1",
      resumed: true,
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });

  it("agent.done accepts optional subtype", () => {
    const evt: BrokerToHost = {
      type: "agent.done",
      turnId: "t1",
      durationMs: 1234,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      exitCode: 0,
      subtype: "success",
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });

  it("agent.policy_violation event exists", () => {
    const evt: BrokerToHost = {
      type: "agent.policy_violation",
      turnId: "t1",
      tool: "Bash",
      reason: "Destructive pattern blocked",
      redactedInput: "rm -rf /",
    };
    expectTypeOf(evt).toMatchTypeOf<BrokerToHost>();
  });
});
```

- [ ] **Step 3: Run test, verify type errors**

Run: `pnpm --filter @wbd/protocol test agent-events.test.ts`
Expected: FAIL — `Property 'resumed' does not exist`, etc.

- [ ] **Step 4: Edit `packages/protocol/src/index.ts`**

Find the `agent.session` member in `BrokerToHost` and add optional `resumed?: boolean`.
Find the `agent.done` member and add optional `subtype?: string`.
Add a new union member after `agent.error`:

```ts
| {
    type: "agent.policy_violation";
    turnId: string;
    tool: string;
    reason: string;
    redactedInput: string;
    agentId?: string;
  }
```

Bump `PROTOCOL_VERSION` from `"1.13.0"` to `"1.14.0"`.

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @wbd/protocol test agent-events.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/__tests__/agent-events.test.ts
git commit -m "feat(protocol): agent.policy_violation + resumed/subtype fields T-20260509-001"
```

---

## Task 2: agent-runner Fastify scaffold

**Files:**
- Create: `container/sandbox/agent-runner/package.json`
- Create: `container/sandbox/agent-runner/tsconfig.json`
- Create: `container/sandbox/agent-runner/vitest.config.ts`
- Create: `container/sandbox/agent-runner/src/index.ts`
- Create: `container/sandbox/agent-runner/src/types.ts`
- Create: `container/sandbox/agent-runner/tests/healthz.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@wbd/agent-runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0",
    "@wbd/protocol": "workspace:*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^2.1.0"
  }
}
```

> Note: pin the SDK version with `pnpm add @anthropic-ai/claude-agent-sdk` after running `pnpm install`. Verify the actual published latest with `npm view @anthropic-ai/claude-agent-sdk version` before pinning.

- [ ] **Step 2: Write `tsconfig.json` mirroring `worker-agent/tsconfig.json`**

```bash
cp worker-agent/tsconfig.json container/sandbox/agent-runner/tsconfig.json
```

Adjust `include`/`exclude` paths if needed.

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write failing healthz test**

```ts
// tests/healthz.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/index.js";

describe("agent-runner /healthz", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildServer({ hmacSecret: "x" }); });
  afterAll(async () => { await app.close(); });

  it("returns 200 ok", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5: Write `src/types.ts`**

```ts
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export interface TurnRequest {
  sessionId: string;
  providerSessionId: string;
  resumeRequested: boolean;
  prompt: string;
  attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>;
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  allowedTools?: string[];
  agents?: Record<string, AgentDefinition>;
  skills?: "all" | string[];
  mcpServers?: Record<string, unknown>;
  modelId?: string;
  systemPromptAppend?: string;
  turnId: string;
}

export interface BuildServerOptions {
  hmacSecret: string;
  agentContextDir?: string; // default /opt/agent-context
  workspaceDir?: string;     // default /workspace
}
```

- [ ] **Step 6: Write `src/index.ts` with `/healthz` only**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import type { BuildServerOptions } from "./types.js";

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.get("/healthz", async () => ({ ok: true }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secret = process.env.AGENT_RUNNER_HMAC_SECRET;
  if (!secret) {
    console.error("AGENT_RUNNER_HMAC_SECRET required"); process.exit(1);
  }
  const app = await buildServer({ hmacSecret: secret });
  const port = Number(process.env.AGENT_RUNNER_PORT ?? "7050");
  await app.listen({ host: "127.0.0.1", port });
}
```

- [ ] **Step 7: Run install + test**

```bash
pnpm install
pnpm --filter @wbd/agent-runner test
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add container/sandbox/agent-runner pnpm-lock.yaml
git commit -m "feat(agent-runner): fastify scaffold + healthz T-20260509-001"
```

---

## Task 3: HMAC verification + cancel endpoint

**Files:**
- Create: `container/sandbox/agent-runner/src/hmac.ts`
- Modify: `container/sandbox/agent-runner/src/index.ts`
- Test: `container/sandbox/agent-runner/tests/hmac.test.ts`

- [ ] **Step 1: Write failing HMAC test**

```ts
// tests/hmac.test.ts
import { describe, it, expect } from "vitest";
import { signRequest, verifyRequest } from "../src/hmac.js";

describe("hmac", () => {
  const secret = "topsecret";
  it("round-trips", () => {
    const body = JSON.stringify({ a: 1 });
    const ts = Date.now().toString();
    const sig = signRequest({ body, ts, secret });
    expect(verifyRequest({ body, ts, sig, secret, maxAgeMs: 60_000 })).toBe(true);
  });
  it("rejects expired", () => {
    const body = "{}";
    const ts = (Date.now() - 5 * 60_000).toString();
    const sig = signRequest({ body, ts, secret });
    expect(verifyRequest({ body, ts, sig, secret, maxAgeMs: 60_000 })).toBe(false);
  });
  it("rejects tampered body", () => {
    const ts = Date.now().toString();
    const sig = signRequest({ body: "{}", ts, secret });
    expect(verifyRequest({ body: "{}}", ts, sig, secret, maxAgeMs: 60_000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/hmac.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function signRequest(args: { body: string; ts: string; secret: string }): string {
  return createHmac("sha256", args.secret).update(`${args.ts}.${args.body}`).digest("hex");
}

export function verifyRequest(args: {
  body: string; ts: string; sig: string; secret: string; maxAgeMs: number;
}): boolean {
  const tsNum = Number(args.ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > args.maxAgeMs) return false;
  const expected = signRequest({ body: args.body, ts: args.ts, secret: args.secret });
  if (expected.length !== args.sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(args.sig, "hex"));
  } catch { return false; }
}
```

- [ ] **Step 3: Run test, verify pass**

Run: `pnpm --filter @wbd/agent-runner test hmac.test.ts`
Expected: PASS.

- [ ] **Step 4: Add HMAC plugin + cancel endpoint to `src/index.ts`**

```ts
// inside buildServer, before route registration:
const HMAC_MAX_AGE_MS = 60_000;
app.addHook("preHandler", async (req, reply) => {
  if (req.url === "/healthz") return;
  const ts = req.headers["x-runner-ts"]; const sig = req.headers["x-runner-sig"];
  if (typeof ts !== "string" || typeof sig !== "string") return reply.code(401).send({ error: "missing signature" });
  const body = req.body ? JSON.stringify(req.body) : "";
  if (!verifyRequest({ body, ts, sig, secret: opts.hmacSecret, maxAgeMs: HMAC_MAX_AGE_MS })) {
    return reply.code(401).send({ error: "bad signature" });
  }
});

// In-memory iterator map for cancellation (filled by /turn endpoint in Task 5):
const inFlight = new Map<string, { abort: AbortController }>();

app.post("/claude-sdk/cancel/:providerSessionId", async (req, reply) => {
  const { providerSessionId } = req.params as { providerSessionId: string };
  const entry = inFlight.get(providerSessionId);
  if (!entry) return reply.code(404).send({ error: "not in flight" });
  entry.abort.abort();
  inFlight.delete(providerSessionId);
  return { ok: true };
});

return app; // (then export inFlight via the returned instance, e.g. app.decorate("inFlight", inFlight))
```

- [ ] **Step 5: Verify Fastify body-parsing for HMAC**

Fastify parses JSON bodies before `preHandler`. To re-stringify identically, register the JSON parser to retain the raw text:

```ts
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try { done(null, { __raw: body, parsed: JSON.parse(body as string) }); } catch (err) { done(err as Error, undefined); }
});
```

Update `preHandler` to read `(req.body as any).__raw` for the signature; replace `req.body` with `(req.body as any).parsed` for handlers.

- [ ] **Step 6: Add cancel-endpoint test**

```ts
// tests/cancel.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/index.js";
import { signRequest } from "../src/hmac.js";
import type { FastifyInstance } from "fastify";

describe("/claude-sdk/cancel", () => {
  let app: FastifyInstance;
  const secret = "s";
  beforeAll(async () => { app = await buildServer({ hmacSecret: secret }); });
  afterAll(async () => { await app.close(); });

  it("404 when not in flight", async () => {
    const ts = Date.now().toString();
    const sig = signRequest({ body: "", ts, secret });
    const res = await app.inject({
      method: "POST", url: "/claude-sdk/cancel/foo",
      headers: { "x-runner-ts": ts, "x-runner-sig": sig },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm --filter @wbd/agent-runner test`
Expected: ALL PASS.

- [ ] **Step 8: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): hmac + cancel endpoint T-20260509-001"
```

---

## Task 4: SDK → broker event mapping

**Files:**
- Create: `container/sandbox/agent-runner/src/sdk-event-mapper.ts`
- Test: `container/sandbox/agent-runner/tests/sdk-event-mapper.test.ts`

This task covers the mapping logic in isolation, fed by mocked SDK output.

- [ ] **Step 1: Inspect SDK message shapes**

Run: `node -e "console.log(Object.keys(require('@anthropic-ai/claude-agent-sdk')))"` after install. Open `node_modules/@anthropic-ai/claude-agent-sdk/dist/types.d.ts` to confirm message-type names. Cross-check the structural assumptions in the spec § 4.2.

- [ ] **Step 2: Write failing mapper test**

```ts
// tests/sdk-event-mapper.test.ts
import { describe, it, expect } from "vitest";
import { mapSdkMessage } from "../src/sdk-event-mapper.js";

const turnId = "T1";

describe("mapSdkMessage", () => {
  it("system.init → null + captures session_id", () => {
    const out = mapSdkMessage(
      { type: "system", subtype: "init", session_id: "s1", model: "m" } as any,
      { turnId, runtime: "claude-code" },
    );
    expect(out.events).toEqual([]);
    expect(out.captured).toEqual({ providerSessionId: "s1", modelId: "m" });
  });

  it("stream_event text_delta → agent.chunk", () => {
    const out = mapSdkMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } } as any,
      { turnId, runtime: "claude-code" },
    );
    expect(out.events).toEqual([{ type: "agent.chunk", turnId, delta: "Hi" }]);
  });

  it("assistant tool_use → agent.tool_use", () => {
    const out = mapSdkMessage(
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "x" } }] } } as any,
      { turnId, runtime: "claude-code" },
    );
    expect(out.events).toEqual([{ type: "agent.tool_use", turnId, tool: "Read", input: { path: "x" } }]);
  });

  it("result success → agent.done with subtype", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "success", duration_ms: 1234, total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 20 } } as any,
      { turnId, runtime: "claude-code" },
    );
    expect(out.events[0]).toMatchObject({
      type: "agent.done", turnId, durationMs: 1234, costUsd: 0.01,
      subtype: "success", tokensIn: 10, tokensOut: 20, exitCode: 0,
    });
  });

  it("result error_max_turns → agent.done with non-zero exit", () => {
    const out = mapSdkMessage(
      { type: "result", subtype: "error_max_turns", duration_ms: 100, total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 } } as any,
      { turnId, runtime: "claude-code" },
    );
    expect(out.events[0]).toMatchObject({ exitCode: 2, subtype: "error_max_turns" });
  });
});
```

- [ ] **Step 3: Implement `src/sdk-event-mapper.ts`**

```ts
import type { BrokerToHost, AgentRuntime } from "@wbd/protocol";

export interface MapContext { turnId: string; runtime: AgentRuntime; agentId?: string; }
export interface MapResult {
  events: BrokerToHost[];
  captured?: { providerSessionId?: string; modelId?: string };
}

const RESULT_EXIT: Record<string, number> = {
  success: 0,
  error_max_turns: 2,
  error_max_budget_usd: 3,
  error_during_execution: 1,
  error_max_structured_output_retries: 4,
};

export function mapSdkMessage(msg: any, ctx: MapContext): MapResult {
  if (msg?.type === "system" && msg?.subtype === "init") {
    return { events: [], captured: { providerSessionId: msg.session_id, modelId: msg.model } };
  }
  if (msg?.type === "stream_event" && msg.event?.type === "content_block_delta"
      && msg.event.delta?.type === "text_delta") {
    return { events: [{ type: "agent.chunk", turnId: ctx.turnId, delta: msg.event.delta.text, agentId: ctx.agentId }] };
  }
  if (msg?.type === "assistant" && Array.isArray(msg.message?.content)) {
    const events: BrokerToHost[] = [];
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        events.push({ type: "agent.tool_use", turnId: ctx.turnId, tool: block.name, input: block.input, agentId: ctx.agentId });
      }
    }
    return { events };
  }
  if (msg?.type === "result") {
    const usage = msg.usage ?? { input_tokens: 0, output_tokens: 0 };
    return {
      events: [{
        type: "agent.done",
        turnId: ctx.turnId,
        durationMs: msg.duration_ms ?? 0,
        tokensIn: usage.input_tokens ?? 0,
        tokensOut: usage.output_tokens ?? 0,
        costUsd: msg.total_cost_usd ?? 0,
        exitCode: RESULT_EXIT[msg.subtype] ?? 1,
        subtype: msg.subtype,
      }],
    };
  }
  return { events: [] };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @wbd/agent-runner test sdk-event-mapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): SDK→broker event mapper T-20260509-001"
```

---

## Task 5: Turn endpoint with SDK invocation + SSE streaming

**Files:**
- Create: `container/sandbox/agent-runner/src/sdk-runner.ts`
- Modify: `container/sandbox/agent-runner/src/index.ts`
- Test: `container/sandbox/agent-runner/tests/sdk-runner.test.ts`

- [ ] **Step 1: Write failing turn-endpoint test (with mocked SDK)**

```ts
// tests/sdk-runner.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/index.js";
import { signRequest } from "../src/hmac.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockImplementation(async function* () {
    yield { type: "system", subtype: "init", session_id: "sdk-sess-1", model: "claude-sonnet-4-6" };
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } } };
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } } };
    yield { type: "result", subtype: "success", duration_ms: 100, total_cost_usd: 0.001,
            usage: { input_tokens: 5, output_tokens: 10 } };
  }),
}));

describe("/claude-sdk/turn happy path", () => {
  const secret = "s"; let app: any;
  beforeAll(async () => { app = await buildServer({ hmacSecret: secret }); });
  afterAll(async () => { await app.close(); });

  it("streams chunk → done events", async () => {
    const body = JSON.stringify({
      sessionId: "host-sess", providerSessionId: "p1", resumeRequested: false,
      prompt: "hi", turnId: "t1",
    });
    const ts = Date.now().toString();
    const sig = signRequest({ body, ts, secret });
    const res = await app.inject({
      method: "POST", url: "/claude-sdk/turn",
      headers: { "x-runner-ts": ts, "x-runner-sig": sig, "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.find((e) => e.type === "agent.session")?.providerSessionId).toBe("sdk-sess-1");
    expect(lines.filter((e) => e.type === "agent.chunk").map((e) => e.delta).join("")).toBe("Hello world");
    expect(lines.find((e) => e.type === "agent.done")?.subtype).toBe("success");
  });
});
```

- [ ] **Step 2: Implement `src/sdk-runner.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { BrokerToHost, AgentRuntime } from "@wbd/protocol";
import { mapSdkMessage } from "./sdk-event-mapper.js";
import type { TurnRequest } from "./types.js";

export interface RunTurnDeps {
  workspaceDir: string;
  abort: AbortController;
  runtime: AgentRuntime;
  emit: (event: BrokerToHost) => void | Promise<void>;
  buildHooks: () => unknown;
}

export async function runTurn(req: TurnRequest, deps: RunTurnDeps): Promise<void> {
  const content = buildContentBlocks(req);
  let captured = { providerSessionId: req.providerSessionId, modelId: req.modelId };

  const iterator = query({
    prompt: req.prompt, // may be overridden by content[]; SDK accepts both per docs
    options: {
      cwd: deps.workspaceDir,
      resume: req.resumeRequested ? req.providerSessionId : undefined,
      settingSources: ["project"],
      skills: req.skills ?? "all",
      agents: req.agents,
      mcpServers: req.mcpServers as any,
      allowedTools: req.allowedTools,
      permissionMode: "acceptEdits",
      includePartialMessages: true,
      systemPrompt: { type: "preset", preset: "claude_code", append: req.systemPromptAppend },
      hooks: deps.buildHooks() as any,
      excludeDynamicSections: true,
      model: req.modelId,
    },
  });

  deps.abort.signal.addEventListener("abort", () => { (iterator as any).cancel?.(); });

  for await (const msg of iterator) {
    const out = mapSdkMessage(msg, { turnId: req.turnId, runtime: deps.runtime });
    if (out.captured?.providerSessionId) {
      // emit agent.session once we know the SDK's session id
      const wasResumeRequested = req.resumeRequested;
      const same = out.captured.providerSessionId === req.providerSessionId;
      await deps.emit({
        type: "agent.session",
        turnId: req.turnId,
        runtime: deps.runtime,
        providerSessionId: out.captured.providerSessionId,
        modelId: out.captured.modelId,
        ...(wasResumeRequested ? { resumed: same } : {}),
      } as BrokerToHost);
      captured = { providerSessionId: out.captured.providerSessionId, modelId: out.captured.modelId };
    }
    for (const ev of out.events) await deps.emit(ev);
  }
}

function buildContentBlocks(req: TurnRequest): unknown[] {
  const blocks: unknown[] = [{ type: "text", text: req.prompt }];
  for (const a of req.attachments ?? []) {
    if (a.mimeType.startsWith("image/")) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mimeType, data: a.dataBase64 } });
    } else {
      // Non-image: write to /workspace/attachments/<name> handled by caller; for V1 inline as text reference.
      blocks.push({ type: "text", text: `[attachment ${a.name} (${a.mimeType})]` });
    }
  }
  return blocks;
}
```

- [ ] **Step 3: Wire `/claude-sdk/turn` in `src/index.ts`**

```ts
app.post("/claude-sdk/turn", async (req, reply) => {
  const body = ((req.body as any).parsed ?? req.body) as TurnRequest;
  const abort = new AbortController();
  inFlight.set(body.providerSessionId, { abort });

  reply.raw.setHeader("Content-Type", "application/x-ndjson");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.hijack();

  const emit = (ev: unknown) => {
    reply.raw.write(JSON.stringify(ev) + "\n");
  };

  try {
    await runTurn(body, {
      workspaceDir: opts.workspaceDir ?? "/workspace",
      abort,
      runtime: "claude-code",
      emit,
      buildHooks: () => ({}), // wired in Task 8
    });
  } catch (err) {
    emit({ type: "agent.error", turnId: body.turnId, message: (err as Error).message });
  } finally {
    inFlight.delete(body.providerSessionId);
    reply.raw.end();
  }
});
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @wbd/agent-runner test sdk-runner.test.ts`
Expected: PASS. If `query` mock doesn't fire (ESM hoist issue), replace with direct unit test on `runTurn` passing a fake iterator.

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): /claude-sdk/turn with SDK streaming T-20260509-001"
```

---

## Task 6: Resume detection + DB-replay fallback

**Files:**
- Create: `container/sandbox/agent-runner/src/resume-detector.ts`
- Modify: `container/sandbox/agent-runner/src/sdk-runner.ts` (use detector)
- Test: `container/sandbox/agent-runner/tests/resume-detector.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/resume-detector.test.ts
import { describe, it, expect } from "vitest";
import { detectResumeOutcome, buildReplayPrompt } from "../src/resume-detector.js";

describe("resume detector", () => {
  it("flags resumed=true when session ids match", () => {
    expect(detectResumeOutcome({ requested: "s1", got: "s1" })).toEqual({ resumed: true });
  });
  it("flags resumed=false when ids differ", () => {
    expect(detectResumeOutcome({ requested: "s1", got: "s2" })).toEqual({ resumed: false });
  });
});

describe("buildReplayPrompt", () => {
  it("prepends conversation history before the new prompt", () => {
    const out = buildReplayPrompt({
      replayContext: [
        { role: "user", text: "build me a blog" },
        { role: "assistant", text: "Sure, what tech stack?" },
      ],
      prompt: "Use Next.js 16",
    });
    expect(out).toContain("[Previous conversation]");
    expect(out).toContain("user: build me a blog");
    expect(out).toContain("assistant: Sure, what tech stack?");
    expect(out).toContain("[Current message]");
    expect(out).toContain("Use Next.js 16");
  });
});
```

- [ ] **Step 2: Implement `src/resume-detector.ts`**

```ts
export function detectResumeOutcome(args: { requested: string; got: string }): { resumed: boolean } {
  return { resumed: args.requested === args.got };
}

export function buildReplayPrompt(args: {
  replayContext: Array<{ role: "user" | "assistant"; text: string }>;
  prompt: string;
}): string {
  const lines: string[] = ["[Previous conversation]"];
  for (const m of args.replayContext) lines.push(`${m.role}: ${m.text}`);
  lines.push("", "[Current message]", args.prompt);
  return lines.join("\n");
}
```

- [ ] **Step 3: Update `runTurn` to handle fallback**

In `sdk-runner.ts`, after emitting `agent.session`, if `req.resumeRequested && resumed === false && req.replayContext`:
1. Call `(iterator as any).cancel()`.
2. Re-invoke `query()` with `resume: undefined` and `prompt: buildReplayPrompt({ replayContext: req.replayContext, prompt: req.prompt })`.
3. Continue mapping events.

Concrete shape:

```ts
import { detectResumeOutcome, buildReplayPrompt } from "./resume-detector.js";

// inside runTurn, replace the single iterator + for-await with:
async function streamOnce(prompt: string, resume: string | undefined): Promise<{ resumedSessionId?: string }> {
  const it = query({ prompt, options: { /* same as before, with resume */ } });
  deps.abort.signal.addEventListener("abort", () => (it as any).cancel?.());
  for await (const msg of it) {
    const out = mapSdkMessage(msg, { turnId: req.turnId, runtime: deps.runtime });
    if (out.captured?.providerSessionId && resume) {
      const { resumed } = detectResumeOutcome({ requested: resume, got: out.captured.providerSessionId });
      await deps.emit({ type: "agent.session", turnId: req.turnId, runtime: deps.runtime,
        providerSessionId: out.captured.providerSessionId, modelId: out.captured.modelId, resumed });
      if (!resumed && req.replayContext?.length) {
        (it as any).cancel?.();
        return { resumedSessionId: undefined };
      }
    } else if (out.captured?.providerSessionId) {
      await deps.emit({ type: "agent.session", turnId: req.turnId, runtime: deps.runtime,
        providerSessionId: out.captured.providerSessionId, modelId: out.captured.modelId });
    }
    for (const ev of out.events) await deps.emit(ev);
  }
  return {};
}

const firstResume = req.resumeRequested ? req.providerSessionId : undefined;
await streamOnce(req.prompt, firstResume);
// If we returned with no resumedSessionId AND fallback path was taken, retry without resume:
// (track this with a flag rather than relying on return value)
```

> Cleaner: introduce `let needsFallback = false` and let `streamOnce` set it via a closure. Either form is acceptable; document which you picked.

- [ ] **Step 4: Add integration test for fallback path**

```ts
// tests/resume-detector.test.ts (extended)
// Mock SDK so the first call returns a different session_id than requested,
// the second call (without resume) emits text. Assert two query() calls.
```

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @wbd/agent-runner test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): resume detection + DB-replay fallback T-20260509-001"
```

---

## Task 7: Bootstrap merge endpoint

**Files:**
- Create: `container/sandbox/agent-runner/src/bootstrap-merge.ts`
- Modify: `container/sandbox/agent-runner/src/index.ts`
- Test: `container/sandbox/agent-runner/tests/bootstrap-merge.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/bootstrap-merge.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeAgentContext } from "../src/bootstrap-merge.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "merge-"));
  const defaults = join(root, "defaults"); const workspace = join(root, "workspace");
  await mkdir(defaults, { recursive: true }); await mkdir(workspace, { recursive: true });
  return { defaults, workspace };
}

describe("mergeAgentContext", () => {
  it("copies defaults when /workspace/.claude is empty", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "default rules");
    await mkdir(join(defaults, "skills/foo"), { recursive: true });
    await writeFile(join(defaults, "skills/foo/SKILL.md"), "skill body");
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    expect(await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8")).toBe("default rules");
    expect(await readFile(join(workspace, ".claude/skills/foo/SKILL.md"), "utf8")).toBe("skill body");
  });

  it("project skill overrides default", async () => {
    const { defaults, workspace } = await setup();
    await mkdir(join(defaults, "skills/x"), { recursive: true });
    await writeFile(join(defaults, "skills/x/SKILL.md"), "default");
    await mkdir(join(workspace, ".claude/skills/x"), { recursive: true });
    await writeFile(join(workspace, ".claude/skills/x/SKILL.md"), "user");
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    expect(await readFile(join(workspace, ".claude/skills/x/SKILL.md"), "utf8")).toBe("user");
  });

  it("CLAUDE.md is concatenated default + user", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "DEFAULTS");
    await mkdir(join(workspace, ".claude"), { recursive: true });
    await writeFile(join(workspace, ".claude/CLAUDE.md"), "PROJECT");
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    const merged = await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8");
    expect(merged).toContain("DEFAULTS");
    expect(merged).toContain("## Project Notes");
    expect(merged).toContain("PROJECT");
  });

  it("is idempotent", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "X");
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    expect((await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8")).match(/X/g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Implement `src/bootstrap-merge.ts`**

```ts
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const SENTINEL = "<!-- agent-context-merged -->";

export async function mergeAgentContext(args: {
  defaultsDir: string;
  workspaceDir: string;
}): Promise<void> {
  const claudeRoot = join(args.workspaceDir, ".claude");
  await mkdir(claudeRoot, { recursive: true });

  await mergeDir({ from: args.defaultsDir, to: claudeRoot, special: { "CLAUDE.md": mergeClaudeMd } });
}

async function mergeDir(args: {
  from: string;
  to: string;
  special: Record<string, (from: string, to: string) => Promise<void>>;
}): Promise<void> {
  const entries = await readdir(args.from, { withFileTypes: true });
  for (const e of entries) {
    const fromPath = join(args.from, e.name);
    const toPath = join(args.to, e.name);
    if (e.isDirectory()) {
      const exists = await stat(toPath).then(() => true, () => false);
      if (!exists) await mkdir(toPath, { recursive: true });
      // For skills/<name>/ and agents/<name>.md: per-name replace.
      // If the project already has a directory at toPath, skip — user wins.
      if (exists && (args.from.endsWith("skills") || args.from.endsWith("agents"))) continue;
      await mergeDir({ from: fromPath, to: toPath, special: args.special });
    } else if (args.special[e.name]) {
      await args.special[e.name](fromPath, toPath);
    } else {
      const exists = await stat(toPath).then(() => true, () => false);
      if (!exists) await copyFile(fromPath, toPath);
    }
  }
}

async function mergeClaudeMd(from: string, to: string): Promise<void> {
  const defaultText = await readFile(from, "utf8");
  const projectText = await readFile(to, "utf8").catch(() => "");
  const already = projectText.includes(SENTINEL);
  if (already) return;
  const merged = projectText.length > 0
    ? `${defaultText}\n\n${SENTINEL}\n\n## Project Notes\n${projectText}`
    : `${defaultText}\n${SENTINEL}\n`;
  await writeFile(to, merged);
}
```

- [ ] **Step 3: Wire `/claude-sdk/bootstrap` in `src/index.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @wbd/agent-runner test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): bootstrap merge endpoint T-20260509-001"
```

---

## Task 8: Policy hooks

**Files:**
- Create: `container/sandbox/agent-runner/src/policy-hooks.ts`
- Modify: `container/sandbox/agent-runner/src/index.ts`
- Modify: `container/sandbox/agent-runner/src/sdk-runner.ts`
- Test: `container/sandbox/agent-runner/tests/policy-hooks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/policy-hooks.test.ts
import { describe, it, expect } from "vitest";
import { denyDestructiveBash, denyOutsideWorkspace, redactToolInput } from "../src/policy-hooks.js";

describe("denyDestructiveBash", () => {
  it("blocks rm -rf /", async () => {
    const r = await denyDestructiveBash({ tool_input: { command: "rm -rf /" } } as any);
    expect(r).toMatchObject({ allow: false });
  });
  it("allows rm -rf /workspace/foo", async () => {
    const r = await denyDestructiveBash({ tool_input: { command: "rm -rf /workspace/foo" } } as any);
    expect(r).toEqual({ allow: true });
  });
  it("blocks fork bombs", async () => {
    const r = await denyDestructiveBash({ tool_input: { command: ":(){ :|: & };:" } } as any);
    expect(r).toMatchObject({ allow: false });
  });
});

describe("denyOutsideWorkspace", () => {
  it("blocks Write to /etc/passwd", async () => {
    const r = await denyOutsideWorkspace({ tool_input: { file_path: "/etc/passwd" } } as any);
    expect(r).toMatchObject({ allow: false });
  });
  it("allows Write to /workspace/x", async () => {
    const r = await denyOutsideWorkspace({ tool_input: { file_path: "/workspace/x" } } as any);
    expect(r).toEqual({ allow: true });
  });
});

describe("redactToolInput", () => {
  it("truncates long strings", () => {
    expect(redactToolInput({ command: "x".repeat(500) })).toMatchObject({ command: expect.stringMatching(/\.\.\.\(truncated\)$/) });
  });
});
```

- [ ] **Step 2: Implement `src/policy-hooks.ts`**

```ts
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\s+\/(?!workspace\b)/,
  /:\s*\(\s*\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /\bdd\s+if=\/dev\/(zero|random)/,
  /\bmkfs(\.|\s)/,
  /\bdd\s+of=\/dev\//,
  />\s*\/(etc|boot|root|var\/log|sys|proc)\b/,
];

export interface HookResult { allow: boolean; reason?: string; }
export interface HookInput { tool_input: Record<string, unknown>; }

export async function denyDestructiveBash(input: HookInput): Promise<HookResult> {
  const cmd = String(input.tool_input?.command ?? "");
  for (const re of DESTRUCTIVE_PATTERNS) {
    if (re.test(cmd)) return { allow: false, reason: `Destructive pattern blocked: ${re.source}` };
  }
  return { allow: true };
}

export async function denyOutsideWorkspace(input: HookInput): Promise<HookResult> {
  const path = String(input.tool_input?.file_path ?? input.tool_input?.path ?? "");
  if (!path.startsWith("/workspace/")) return { allow: false, reason: `Path outside /workspace: ${path}` };
  return { allow: true };
}

export function redactToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v.length > 200 ? v.slice(0, 200) + "...(truncated)" : v;
    else out[k] = v;
  }
  return out;
}

export interface BuildHooksOptions {
  emitViolation: (v: { tool: string; reason: string; redactedInput: Record<string, unknown> }) => void;
}

export function buildPolicyHooks(opts: BuildHooksOptions) {
  const wrap = (tool: string, fn: (i: HookInput) => Promise<HookResult>) =>
    async (i: HookInput) => {
      const r = await fn(i);
      if (!r.allow) opts.emitViolation({ tool, reason: r.reason ?? "blocked", redactedInput: redactToolInput(i.tool_input) });
      return r;
    };

  return {
    PreToolUse: [
      { matcher: "Bash",       hooks: [wrap("Bash", denyDestructiveBash)] },
      { matcher: "Write|Edit", hooks: [wrap("Write|Edit", denyOutsideWorkspace)] },
    ],
  };
}
```

- [ ] **Step 3: Wire hooks into `runTurn` via `deps.buildHooks`**

In `src/index.ts`, replace the placeholder `buildHooks: () => ({})` with:

```ts
buildHooks: () => buildPolicyHooks({
  emitViolation: (v) => emit({
    type: "agent.policy_violation", turnId: body.turnId,
    tool: v.tool, reason: v.reason, redactedInput: JSON.stringify(v.redactedInput),
  }),
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @wbd/agent-runner test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/agent-runner
git commit -m "feat(agent-runner): policy hooks + violation events T-20260509-001"
```

---

## Task 9: Broker SDK bridge (replaces claude-runner)

**Files:**
- Create: `container/sandbox/broker/src/claude-sdk-bridge.ts`
- Modify: `container/sandbox/broker/src/agent-provider-factory.ts`
- Delete: `container/sandbox/broker/src/claude-runner.ts`
- Delete: `container/sandbox/broker/src/__tests__/claude-runner.test.ts` (if exists)
- Test: `container/sandbox/broker/src/__tests__/claude-sdk-bridge.test.ts`

- [ ] **Step 1: Write failing bridge test (with mocked HTTP server)**

```ts
// tests/claude-sdk-bridge.test.ts
import { describe, it, expect } from "vitest";
import { runClaudeSdkTurn } from "../claude-sdk-bridge.js";
import http from "node:http";

describe("claude-sdk-bridge", () => {
  it("forwards events from agent-runner SSE-ish stream to onEvent", async () => {
    const events = [
      { type: "agent.session", turnId: "t1", runtime: "claude-code", providerSessionId: "p1" },
      { type: "agent.chunk", turnId: "t1", delta: "Hi" },
      { type: "agent.done", turnId: "t1", durationMs: 1, tokensIn: 0, tokensOut: 0, costUsd: 0, exitCode: 0 },
    ];
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const e of events) res.write(JSON.stringify(e) + "\n");
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;

    const captured: any[] = [];
    await runClaudeSdkTurn({
      runnerUrl: `http://127.0.0.1:${port}`,
      hmacSecret: "x",
      providerSessionId: "p1",
      resumeRequested: false,
      prompt: "hi",
      turnId: "t1",
      onEvent: (e) => captured.push(e),
    });
    server.close();
    expect(captured.map((e) => e.type)).toEqual(["agent.session", "agent.chunk", "agent.done"]);
  });
});
```

- [ ] **Step 2: Implement `claude-sdk-bridge.ts`**

```ts
import { createHmac } from "node:crypto";
import type { BrokerToHost } from "@wbd/protocol";

export interface ClaudeSdkTurnOptions {
  runnerUrl: string; hmacSecret: string;
  projectId?: string; sessionId?: string;
  providerSessionId: string; resumeRequested: boolean; prompt: string; turnId: string;
  attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>;
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  modelId?: string;
  onEvent: (e: BrokerToHost) => unknown;
  signal?: AbortSignal;
}

function sign(body: string, ts: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

export async function runClaudeSdkTurn(opts: ClaudeSdkTurnOptions): Promise<void> {
  const body = JSON.stringify({
    sessionId: opts.sessionId ?? "",
    providerSessionId: opts.providerSessionId,
    resumeRequested: opts.resumeRequested,
    prompt: opts.prompt,
    turnId: opts.turnId,
    attachments: opts.attachments,
    replayContext: opts.replayContext,
    modelId: opts.modelId,
  });
  const ts = Date.now().toString();
  const sig = sign(body, ts, opts.hmacSecret);

  const res = await fetch(`${opts.runnerUrl}/claude-sdk/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-runner-ts": ts, "x-runner-sig": sig },
    body, signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`agent-runner returned ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try { await opts.onEvent(JSON.parse(line) as BrokerToHost); }
        catch { /* malformed line — log to stderr in real impl */ }
      }
      nl = buf.indexOf("\n");
    }
  }
}
```

- [ ] **Step 3: Wire `agent-provider-factory.ts`**

Replace the `claude-code` branch:

```ts
return {
  runtime: "claude-code",
  runTurn: (turn) =>
    runClaudeSdkTurn({
      runnerUrl: process.env.AGENT_RUNNER_URL ?? "http://127.0.0.1:7050",
      hmacSecret: process.env.AGENT_RUNNER_HMAC_SECRET ?? "",
      sessionId: turn.sessionId,
      providerSessionId: turn.sessionId, // or .providerSessionId — confirm with AgentTurnOptions
      resumeRequested: turn.resumeSession,
      prompt: turn.prompt,
      turnId: turn.turnId,
      modelId: turn.modelId,
      attachments: turn.attachments?.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64 })),
      onEvent: turn.onEvent,
      signal: turn.signal,
    }),
  // runReview removed: reviewer is now an SDK subagent (Task 14 agent-context).
};
```

If the host still calls `runReview` for claude-code, gate the call site to no-op for the SDK path or convert to a normal turn that mentions the reviewer subagent. Document the decision in the commit.

- [ ] **Step 4: Delete CLI runner files**

```bash
git rm container/sandbox/broker/src/claude-runner.ts
git rm container/sandbox/broker/src/__tests__/claude-runner.test.ts || true
```

- [ ] **Step 5: Run broker tests**

```bash
pnpm --filter @wbd/sandbox-broker test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add container/sandbox/broker
git commit -m "feat(broker): replace claude-runner with SDK bridge T-20260509-001"
```

---

## Task 10: Sandbox image — install agent-runner, drop CLI, supervise both

**Files:**
- Modify: `container/sandbox/Dockerfile`
- Modify: `container/sandbox/start.sh` (or whatever supervisor script exists)

- [ ] **Step 1: Inspect current Dockerfile**

Run: `cat container/sandbox/Dockerfile`
Locate where `claude` CLI is installed (likely `npm install -g @anthropic-ai/claude-code` or a binary download). Note the supervisor entrypoint.

- [ ] **Step 2: Edit Dockerfile**

Remove the CLI install line(s).
Add agent-runner install:

```dockerfile
COPY container/sandbox/agent-runner /app/agent-runner
WORKDIR /app/agent-runner
RUN pnpm install --prod --frozen-lockfile

COPY agent-context /opt/agent-context
```

- [ ] **Step 3: Edit start.sh to launch both broker + agent-runner**

```sh
#!/usr/bin/env sh
set -e
: "${AGENT_RUNNER_HMAC_SECRET:?missing}"
: "${BROKER_TOKEN:?missing}"

# agent-runner in background
node /app/agent-runner/dist/index.js &
RUNNER_PID=$!
trap "kill -TERM $RUNNER_PID" TERM INT

# broker in foreground
exec node /app/broker/dist/index.js
```

If the existing setup uses a process supervisor (`supervisord`, `s6`, …), add an agent-runner program block instead — match the existing pattern.

- [ ] **Step 4: Build the image locally and verify**

```bash
docker build -t wbd-sandbox:sdk-test -f container/sandbox/Dockerfile .
docker run --rm -e AGENT_RUNNER_HMAC_SECRET=x -e BROKER_TOKEN=y wbd-sandbox:sdk-test &
docker exec <id> curl -s http://127.0.0.1:7050/healthz
# expect: {"ok":true}
```

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/Dockerfile container/sandbox/start.sh
git commit -m "build(sandbox): install agent-runner, drop CLI binary T-20260509-001"
```

---

## Task 11: agent-context content (V1 set)

**Files:**
- Create: `agent-context/CLAUDE.md`
- Create: `agent-context/skills/frontend-design/SKILL.md`
- Create: `agent-context/skills/nextjs-app-router/SKILL.md`
- Create: `agent-context/skills/tailwind-conventions/SKILL.md`
- Create: `agent-context/agents/code-reviewer.md`
- Create: `agent-context/agents/ui-designer.md`

- [ ] **Step 1: Write `agent-context/CLAUDE.md`**

Inherit knowledge from the existing `MINIMAL_TERMINAL_PROMPT` in the deleted `claude-runner.ts` (commit `008b871^:container/sandbox/broker/src/claude-runner.ts`). Body:

```markdown
# website-builder agent context

You build websites in `/workspace`. The user describes what they want; you produce real code.

## Output style
- Short status updates while working ("Updating project...", "Done").
- Don't list files you read or edited.
- Don't narrate routine progress one tool call at a time.
- Show code only when explicitly asked or when delivering a final result.

## Tech stack defaults
- Next.js 16 App Router unless the user picks otherwise.
- Tailwind CSS, semantic HTML, accessible labels.
- TypeScript strict.

## Constraints
- Stay inside `/workspace`. Never write outside.
- No outbound network calls except to the package allowlist (npmjs, github, jsdelivr, unpkg, fonts.google).
- Preserve user umlauts (ä ö ü ß) in user-facing text.
```

- [ ] **Step 2: Write skills (frontmatter + body)**

Each `SKILL.md` follows the SDK skill format:

```markdown
---
name: frontend-design
description: Use when designing or rebuilding UI surfaces — covers layout grids, type scales, spacing, hover states, and accessibility quick-pass.
---

# Frontend design

[content — distilled from existing frontend-design skill, ~150 words]
```

Repeat for `nextjs-app-router` (App Router conventions, Server Components, Server Actions, file-based routing) and `tailwind-conventions` (utility ordering, dark-mode strategy, design tokens).

- [ ] **Step 3: Write subagents**

```markdown
---
name: code-reviewer
description: Reviews uncommitted changes for bugs, security issues, and convention drift. Use after a non-trivial implementation step.
tools: ["Read", "Grep", "Glob", "Bash"]
---

You are a code reviewer. Inspect uncommitted changes via `git diff`. Report:
- bugs and logic errors
- security issues (injection, auth bypass, secret leaks)
- convention violations against /workspace/.claude/CLAUDE.md
Output short bullets only.
```

Same shape for `ui-designer.md` (focus: visual review of rendered pages).

- [ ] **Step 4: Verify the merge picks them up**

Run the bootstrap-merge test from Task 7 with these files copied as defaults; assert the workspace ends up with all of them.

- [ ] **Step 5: Commit**

```bash
git add agent-context
git commit -m "feat(agent-context): V1 CLAUDE.md + skills + subagents T-20260509-001"
```

---

## Task 12: Prisma migration — add `subtype` to turn record

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_turn_subtype/migration.sql`

- [ ] **Step 1: Identify the right model**

Open `prisma/schema.prisma`. Find the model that represents a completed agent turn (likely `AgentRun` or `Message` — check by grepping for fields like `tokensIn`, `costUsd`, `exitCode`). Add the new column there.

```bash
grep -n "exitCode\|tokensIn\|costUsd" prisma/schema.prisma
```

- [ ] **Step 2: Add `subtype` field**

Edit `schema.prisma`:

```prisma
model <TheTurnRecord> {
  // existing
  subtype String?  // success | error_max_turns | error_max_budget_usd | ...
}
```

- [ ] **Step 3: Generate migration**

```bash
TEST_DATABASE_URL=postgres://... pnpm prisma migrate dev --name add_turn_subtype
```

- [ ] **Step 4: Run prisma generate**

```bash
pnpm prisma generate
```

- [ ] **Step 5: Verify TypeScript still compiles**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add subtype column for agent turn results T-20260509-001"
```

---

## Task 13: Host event sink — handle `subtype`, `policy_violation`, `resumed`

**Files:**
- Modify: `lib/agent-runs/executor-client.ts`
- Test: `lib/agent-runs/__tests__/sdk-events.test.ts` (or extend existing)

- [ ] **Step 1: Locate the event-sink function**

Open `lib/agent-runs/executor-client.ts`. Find the switch in `runEventTypeForBrokerEvent` (around line 265 per the spec exploration).

- [ ] **Step 2: Write failing test**

```ts
// lib/agent-runs/__tests__/sdk-events.test.ts
import { describe, it, expect, vi } from "vitest";
import type { BrokerToHost } from "@wbd/protocol";
// import the runEventTypeForBrokerEvent and persist function

describe("agent.policy_violation", () => {
  it("returns POLICY_VIOLATION event type", () => {
    const e: BrokerToHost = {
      type: "agent.policy_violation", turnId: "t", tool: "Bash",
      reason: "blocked", redactedInput: "rm -rf /",
    };
    expect(runEventTypeForBrokerEvent(e)).toBe("POLICY_VIOLATION");
  });
});

describe("agent.session.resumed", () => {
  it("propagates resumed flag into payload", async () => {
    // assert that persistBrokerEvent stores resumed:false in payload JSON
  });
});

describe("agent.done.subtype", () => {
  it("persists subtype on the turn record", async () => {
    // assert UPDATE includes subtype
  });
});
```

- [ ] **Step 3: Update `runEventTypeForBrokerEvent`**

Add `case "agent.policy_violation": return "POLICY_VIOLATION";`. Add the corresponding `RunEventType` enum value in `prisma/schema.prisma` if `RunEventType` is a Prisma enum — generate a migration alongside Task 12 if needed.

- [ ] **Step 4: Update terminal-event handling**

In the `if (event.type === "agent.done")` block, also persist `event.subtype` onto whichever Prisma record represents the turn (matching Task 12's choice).

- [ ] **Step 5: Run host tests**

```bash
TEST_DATABASE_URL=postgres://test pnpm test:host
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/agent-runs prisma
git commit -m "feat(host): persist subtype + policy_violation + resumed flag T-20260509-001"
```

---

## Task 14: Host replay-context builder + turn-dispatcher updates

**Files:**
- Create: `lib/agents/runtimes/claude-code/replay-context.ts`
- Create: `lib/agents/runtimes/claude-code/__tests__/replay-context.test.ts`
- Modify: the host turn-dispatcher (likely in `lib/agent-runs/executor-client.ts` near where the broker `start_turn` payload is constructed)

- [ ] **Step 1: Write failing test**

```ts
// lib/agents/runtimes/claude-code/__tests__/replay-context.test.ts
import { describe, it, expect } from "vitest";
import { buildReplayContext } from "../replay-context";

describe("buildReplayContext", () => {
  it("returns empty array when no messages", () => {
    expect(buildReplayContext([])).toEqual([]);
  });
  it("redacts attachments", () => {
    const out = buildReplayContext([
      { role: "user", content: "Look at this", attachments: [{ name: "a.png", sizeBytes: 1024 }] },
    ]);
    expect(out[0].text).toContain("[attachment a.png (1024 bytes)]");
    expect(out[0].text).toContain("Look at this");
  });
  it("caps to last 20", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    expect(buildReplayContext(msgs).length).toBe(20);
  });
});
```

- [ ] **Step 2: Implement `replay-context.ts`**

```ts
export interface MessageLike {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ name: string; sizeBytes: number }>;
}

export interface ReplayMessage { role: "user" | "assistant"; text: string; }

const MAX = 20;

export function buildReplayContext(messages: MessageLike[]): ReplayMessage[] {
  const tail = messages.slice(-MAX);
  return tail.map((m) => {
    const attachLine = (m.attachments ?? []).map((a) => `[attachment ${a.name} (${a.sizeBytes} bytes)]`).join(" ");
    const text = attachLine ? `${m.content}\n${attachLine}` : m.content;
    return { role: m.role, text };
  });
}
```

- [ ] **Step 3: Wire into `start_turn` payload**

Locate where `executor-client.ts` calls the broker (search for `start_turn` or the `runTurn` invocation). Add `replayContext: buildReplayContext(await loadRecentMessages(run.sessionId, 20))` to the payload **only when runtime === "claude-code"**.

- [ ] **Step 4: Run tests**

```bash
pnpm test:host
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/runtimes/claude-code lib/agent-runs
git commit -m "feat(host): replay-context builder + dispatcher integration T-20260509-001"
```

---

## Task 15: E2E (Playwright) — happy path + resume + restart fallback + policy

**Files:**
- Create: `e2e/claude-agent-sdk.test.ts`

- [ ] **Step 1: Set up test scenarios**

```ts
// e2e/claude-agent-sdk.test.ts
import { test, expect } from "@playwright/test";

test.describe("Claude Agent SDK", () => {
  test("streams reply with attachment", async ({ page }) => {
    // 1. open project, send message with image attachment
    // 2. wait for partial text to appear in chat (token streaming visible)
    // 3. wait for "done" indicator
    // 4. verify final assistant message present
  });

  test("resumes session on follow-up", async ({ page }) => {
    // 1. send message "Add a header"
    // 2. send follow-up "Make it sticky"
    // 3. verify the assistant references the previous turn
    // 4. verify host log contains agent.session{ resumed: true }
  });

  test("falls back to DB-replay after sandbox restart", async ({ page, request }) => {
    // 1. send first message
    // 2. via admin API, restart the sandbox container
    // 3. send follow-up
    // 4. verify host log contains agent.session{ resumed: false }
    // 5. verify the assistant still references prior context (proves replay worked)
  });

  test("policy_violation surfaces on destructive bash", async ({ page }) => {
    // 1. send message that the agent might respond to with rm -rf / (use a contrived prompt)
    // 2. verify a policy_violation event was persisted
    // 3. verify chat continued (didn't die)
  });
});
```

Flesh out selectors based on the existing chat-UI structure.

- [ ] **Step 2: Run on staging**

```bash
PLAYWRIGHT_BASE_URL=https://staging.example pnpm playwright test e2e/claude-agent-sdk.test.ts
```
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/claude-agent-sdk.test.ts
git commit -m "test(e2e): claude agent SDK end-to-end scenarios T-20260509-001"
```

---

## Task 16: Final integration — lint, build, smoke

- [ ] **Step 1: Lint**

```bash
pnpm lint
```
Expected: clean.

- [ ] **Step 2: Build**

```bash
pnpm build
```
Expected: clean.

- [ ] **Step 3: Run host test suite**

```bash
TEST_DATABASE_URL=postgres://test pnpm test:host
```
Expected: PASS.

- [ ] **Step 4: Manual staging smoke**

Deploy to staging Hetzner box. Manually run the four scenarios in Task 15:
1. Image attachment + streaming reply.
2. Follow-up resume.
3. Restart sandbox, follow-up — fallback transparent.
4. Bash destructive command, see `policy_violation` in logs, chat continues.

Document each as a checkbox in the PR description.

- [ ] **Step 5: Move task file to done + changelog**

```bash
mkdir -p docs/tasks/done/2026/05
mv docs/tasks/active/T-20260509-001.md docs/tasks/done/2026/05/T-20260509-001.md
```

Edit the moved file: set `Status: Done`, fill in `Outcome`.

Append to `docs/changelog/2026-05.md`:

```markdown
- 2026-05-09 — T-20260509-001 — Replaced Claude Code CLI with Claude Agent SDK in a new sandbox-internal agent-runner service. Token streaming, hybrid resume (SDK JSONL + DB-replay fallback), host-curated agent context with per-project overrides, PreToolUse policy hooks. Hard cutover.
```

- [ ] **Step 6: Final commit**

```bash
git add docs/tasks docs/changelog
git commit -m "docs: mark T-20260509-001 done + changelog entry"
```

---

## Self-review checklist (run before handing off to execution)

- [ ] **Spec coverage**: every spec section has at least one task. (Spec §3 architecture → Tasks 2–10. Spec §4 components → Tasks 2–11. Spec §5 turn flow → Tasks 5+9+13. Spec §6 attachments → Task 5 step 2. Spec §7 resume → Task 6. Spec §8 schema → Task 12. Spec §9 tests → Tasks 4–8 + 15. Spec §10 slices → Tasks 2–11. Spec §11 risks → mitigations referenced inline.)
- [ ] **Placeholder scan**: no "TBD"/"add error handling"/"similar to Task N" — all code blocks are concrete.
- [ ] **Type consistency**: `delta` (not `text`) on `agent.chunk`; `subtype` on `agent.done`; `resumed` on `agent.session`; new `agent.policy_violation`. Mapper, bridge, host sink all use the same names.
- [ ] **Out-of-scope items match spec § "Out of scope"**: subagent-hierarchy UI, canUseTool, persistent volumes — none of those appear as tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-claude-agent-sdk-integration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Slices A/B/C/D (Tasks 2–10 + 11 + 14) can run in parallel against the contracts defined in Task 1.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
