import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { BrokerToHost, AgentRuntime } from "@wbd/protocol";
import { mapSdkMessage } from "./sdk-event-mapper.js";
import { buildReplayPrompt, detectResumeOutcome } from "./resume-detector.js";
import { fetchOpenRouterCosts } from "./openrouter-cost.js";
import type { TurnRequest } from "./types.js";

/**
 * Best-effort cancel of an SDK query iterator.
 *
 * The SDK's iterator exposes an optional `interrupt()` method that returns a
 * Promise. We invoke it fire-and-forget: callers either break out of the
 * for-await loop (discarding subsequent output) or are tearing down the
 * iterator naturally, so awaiting the resolution would not change behaviour.
 */
function safeInterrupt(iterator: AsyncIterable<unknown>): void {
  const fn = (iterator as { interrupt?: () => Promise<void> }).interrupt;
  if (typeof fn === "function") {
    void fn.call(iterator).catch(() => {
      /* ignore */
    });
  }
}

export interface RunTurnDeps {
  workspaceDir: string;
  abort: AbortController;
  runtime: AgentRuntime;
  emit: (event: BrokerToHost) => void | Promise<void>;
  buildHooks: () => unknown;
  /**
   * Test seam: allow injecting a fake query function.
   * Defaults to the real Claude Agent SDK `query` export.
   */
  query?: typeof query;
  /**
   * Test seam: allow injecting a fake fetch for OpenRouter cost lookups.
   * Defaults to `globalThis.fetch` in production.
   */
  __testFetch?: typeof globalThis.fetch;
}

/**
 * Run a single Claude Agent SDK turn.
 *
 * High-level flow:
 *
 *   1. Call `query()` with `resume: providerSessionId` if the host requested
 *      resume, otherwise with `resume: undefined`.
 *   2. On the FIRST `system.init` we receive, capture the SDK's session id and
 *      emit `agent.session`.
 *   3. If resume was requested but the SDK returned a different session id,
 *      the JSONL transcript was missing — silently the SDK started fresh. We
 *      detect that, emit `agent.session { resumed: false }` for the failed
 *      session id, abandon the iterator via `interrupt()`, then re-call
 *      `query()` WITHOUT resume, with a prompt augmented by the host-supplied
 *      `replayContext` (DB-replay fallback). A second `agent.session` is
 *      emitted for the fresh session id (also `resumed: false`); the host
 *      treats the latest one as authoritative.
 *   4. If resume succeeded (ids match) we emit `agent.session { resumed: true }`
 *      and continue streaming normally.
 *   5. If resume was not requested at all, no `resumed` flag is sent.
 *
 * Cancellation: `deps.abort.signal` is wired to the currently-active
 * iterator's `interrupt()` (best-effort). If a fallback iterator runs, the
 * abort listener is re-attached for it.
 *
 * The public signature is intentionally unchanged from Task 5 so the HTTP
 * route in `index.ts` does not need to know about the fallback.
 */
export async function runTurn(req: TurnRequest, deps: RunTurnDeps): Promise<void> {
  const queryFn = deps.query ?? query;
  const sdkOptionsBase = buildSdkOptionsBase(req, deps);

  const first = await streamOnce(deps, req, queryFn, {
    expectResume: req.resumeRequested,
    prompt: req.prompt,
    sdkOptions: {
      ...sdkOptionsBase,
      resume: req.resumeRequested ? req.providerSessionId : undefined,
    },
  });

  if (first.failedResume) {
    const replayPrompt = buildReplayPrompt({
      replayContext: req.replayContext ?? [],
      prompt: req.prompt,
    });
    // expectResume=false on the retry: the host already saw `resumed:false`.
    // The fresh session_id from this iterator is reported as a NEW agent.session
    // event; the host updates `providerSessionId` from the latest event.
    await streamOnce(deps, req, queryFn, {
      expectResume: false,
      prompt: replayPrompt,
      sdkOptions: {
        ...sdkOptionsBase,
        resume: undefined,
      },
    });
  }
}

interface StreamOnceOptions {
  /** When true, runTurn detects whether the SDK honoured `resume`. */
  expectResume: boolean;
  /** Prompt to feed `query()`. May be augmented with replay context. */
  prompt: string;
  /** SDK options for this query() call. */
  sdkOptions: Options;
}

interface StreamOnceResult {
  /** True iff resume was requested and the SDK returned a different session id. */
  failedResume: boolean;
}

/**
 * Run a single `query()` invocation and stream its events to `deps.emit`.
 *
 * Owns the abort listener for THIS iterator only (attaches in entry, removes
 * in `finally`) so a subsequent fallback iterator can re-attach cleanly.
 */
async function streamOnce(
  deps: RunTurnDeps,
  req: TurnRequest,
  queryFn: typeof query,
  opts: StreamOnceOptions,
): Promise<StreamOnceResult> {
  const iterator = queryFn({
    prompt: opts.prompt,
    options: opts.sdkOptions,
  });

  const onAbort = () => {
    safeInterrupt(iterator);
  };
  deps.abort.signal.addEventListener("abort", onAbort);

  let agentSessionEmitted = false;
  let failedResume = false;

  const openrouterMode = /openrouter\.ai/i.test(process.env.ANTHROPIC_BASE_URL ?? "");
  const responseIds: string[] = [];

  try {
    for await (const msg of iterator) {
      const out = mapSdkMessage(msg, { turnId: req.turnId, runtime: deps.runtime });

      if (out.capturedMessageId) responseIds.push(out.capturedMessageId);

      if (!agentSessionEmitted && out.captured?.providerSessionId) {
        agentSessionEmitted = true;
        const providerSessionId = out.captured.providerSessionId;

        let resumedFlag: boolean | undefined;
        if (opts.expectResume) {
          const outcome = detectResumeOutcome({
            requested: req.providerSessionId,
            got: providerSessionId,
          });
          resumedFlag = outcome.resumed;
        }

        const sessionEvent: BrokerToHost = {
          type: "agent.session",
          turnId: req.turnId,
          runtime: deps.runtime,
          providerSessionId,
          ...(out.captured.modelId ? { modelId: out.captured.modelId } : {}),
          ...(resumedFlag !== undefined ? { resumed: resumedFlag } : {}),
        };
        await deps.emit(sessionEvent);

        if (resumedFlag === false) {
          failedResume = true;
          // Cancel the wrong session and stop consuming this iterator. The
          // caller will run a second query() with replay context.
          // Fire-and-forget: we exit the for-await via break, so any subsequent
          // generator output is unread and discarded. The async resolution of
          // interrupt() doesn't gate this loop's exit.
          safeInterrupt(iterator);
          break;
        }
      }

      if (!failedResume) {
        for (const ev of out.events) {
          const finalEv = await maybePatchAgentDone(ev, {
            openrouterMode,
            responseIds,
            fetchFn: deps.__testFetch,
          });
          await deps.emit(finalEv);
        }
      }
    }
  } catch (err) {
    // The SDK throws "No conversation found with session ID" when the resume
    // target's transcript file is missing (e.g., sandbox restart after the
    // session was created). Treat this as a silent resume failure so the
    // caller fires the DB-replay fallback path. Re-throw any other error.
    const message = err instanceof Error ? err.message : String(err);
    if (opts.expectResume && /no conversation found with session id/i.test(message)) {
      if (!agentSessionEmitted) {
        await deps.emit({
          type: "agent.session",
          turnId: req.turnId,
          runtime: deps.runtime,
          providerSessionId: req.providerSessionId,
          resumed: false,
        });
        agentSessionEmitted = true;
      }
      failedResume = true;
    } else {
      throw err;
    }
  } finally {
    deps.abort.signal.removeEventListener("abort", onAbort);
  }

  return { failedResume };
}

function buildSdkOptionsBase(req: TurnRequest, deps: RunTurnDeps): Options {
  return {
    cwd: deps.workspaceDir,
    settingSources: ["project"],
    skills: req.skills ?? "all",
    agents: req.agents,
    // The SDK's mcpServers type is a union that's tricky to narrow at the
    // boundary; the host-side schema validates this before we get here.
    mcpServers: req.mcpServers as Options["mcpServers"],
    allowedTools: req.allowedTools,
    permissionMode: "acceptEdits",
    includePartialMessages: true,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: req.systemPromptAppend,
      excludeDynamicSections: true,
    },
    // Hook shape varies across SDK minor versions; the policy layer (Task 8)
    // owns the concrete shape. Cast through unknown because buildHooks is
    // intentionally typed as unknown until Task 8 supplies the real shape.
    hooks: deps.buildHooks() as Options["hooks"],
    model: req.modelId,
    // Cancellation flows through iterator.interrupt() in onAbort below — a
    // single graceful path. Do NOT also pass abortController here; double
    // cancellation races two paths.
  };
}

/**
 * When running against OpenRouter (`ANTHROPIC_BASE_URL` matches openrouter.ai)
 * and we collected one or more assistant message ids during the turn, fetch
 * the aggregate generation cost from OpenRouter and patch the outgoing
 * `agent.done` event before it reaches the host.
 *
 * All other events pass through untouched. If openrouter-mode is not active,
 * if no ids were collected, if the API key is missing, or if every per-id
 * lookup failed, the original `agent.done` is returned unchanged — the
 * host-side `estimateCostUsd` path then handles cost from the SDK values.
 */
async function maybePatchAgentDone(
  ev: BrokerToHost,
  opts: {
    openrouterMode: boolean;
    responseIds: string[];
    fetchFn?: typeof globalThis.fetch;
  },
): Promise<BrokerToHost> {
  if (ev.type !== "agent.done") return ev;
  if (!opts.openrouterMode) return ev;
  if (opts.responseIds.length === 0) return ev;
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) return ev;

  const corrected = await fetchOpenRouterCosts(opts.responseIds, {
    openrouterApiKey: apiKey,
    ...(opts.fetchFn ? { fetch: opts.fetchFn } : {}),
  });
  if (corrected.succeeded === 0) return ev;
  return {
    ...ev,
    costUsd: corrected.totalCost,
    tokensIn: corrected.promptTokens,
    tokensOut: corrected.completionTokens,
  };
}
