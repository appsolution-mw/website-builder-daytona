import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { BrokerToHost, AgentRuntime } from "@wbd/protocol";
import { mapSdkMessage } from "./sdk-event-mapper.js";
import type { TurnRequest } from "./types.js";

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
}

/**
 * Run a single Claude Agent SDK turn.
 *
 * - Calls `query()` with the SDK options derived from the turn request.
 * - Captures the provider session_id from the first `system.init` message and
 *   emits exactly one `agent.session` event.
 * - Streams the rest of the SDK messages through {@link mapSdkMessage} and
 *   forwards each derived broker event via `deps.emit`.
 * - Wires `deps.abort` to the SDK iterator's `interrupt()` (best-effort).
 *
 * Resume detection in this V1 is naive: if `req.resumeRequested` is true, we
 * pass `resume: req.providerSessionId` to the SDK and report `resumed` based
 * on whether the SDK's returned session_id matches the requested one. Task 6
 * replaces this with the real resume detector + DB-replay fallback.
 *
 * Hooks are injected via `deps.buildHooks()` as an opaque value (Task 8 will
 * supply the real PreToolUse/PostToolUse policy hooks).
 */
export async function runTurn(req: TurnRequest, deps: RunTurnDeps): Promise<void> {
  const queryFn = deps.query ?? query;

  const iterator = queryFn({
    prompt: buildPrompt(req),
    options: {
      cwd: deps.workspaceDir,
      resume: req.resumeRequested ? req.providerSessionId : undefined,
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
    },
  });

  // Wire abort to SDK interrupt (best-effort — Query exposes .interrupt() in 0.2.x).
  const onAbort = () => {
    try {
      const maybeInterrupt = (iterator as { interrupt?: () => Promise<void> }).interrupt;
      if (typeof maybeInterrupt === "function") {
        void maybeInterrupt.call(iterator).catch(() => {
          /* ignore */
        });
      }
    } catch {
      /* ignore */
    }
  };
  deps.abort.signal.addEventListener("abort", onAbort);

  let agentSessionEmitted = false;
  try {
    for await (const msg of iterator) {
      const out = mapSdkMessage(msg, { turnId: req.turnId, runtime: deps.runtime });
      if (!agentSessionEmitted && out.captured?.providerSessionId) {
        agentSessionEmitted = true;
        const providerSessionId = out.captured.providerSessionId;
        const sessionEvent: BrokerToHost = {
          type: "agent.session",
          turnId: req.turnId,
          runtime: deps.runtime,
          providerSessionId,
          ...(out.captured.modelId ? { modelId: out.captured.modelId } : {}),
          // Task 6 owns real resume detection. V1 reports based on whether
          // the SDK echoed back the requested providerSessionId.
          ...(req.resumeRequested
            ? { resumed: req.providerSessionId === providerSessionId }
            : {}),
        };
        await deps.emit(sessionEvent);
      }
      for (const ev of out.events) await deps.emit(ev);
    }
  } finally {
    deps.abort.signal.removeEventListener("abort", onAbort);
  }
}

function buildPrompt(req: TurnRequest): string {
  // V1: forward the text prompt as-is. Image attachments will be wired through
  // the SDK content-blocks surface in a follow-up task; for the happy-path V1
  // we only send text. The SDK's `query()` accepts a string prompt.
  return req.prompt;
}
