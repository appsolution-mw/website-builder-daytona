import { createHmac } from "node:crypto";
import type { BrokerToHost, PromptImageAttachment } from "@wbd/protocol";

export interface ClaudeSdkTurnOptions {
  /** Base URL of the agent-runner loopback service, e.g. `http://127.0.0.1:7050`. */
  runnerUrl: string;
  /** Shared HMAC secret for the loopback endpoint. */
  hmacSecret: string;
  /** Logical chat session id. Stable across turns. */
  sessionId: string;
  /** Provider-specific session id used for Claude SDK resume. */
  providerSessionId: string;
  /** True when the caller wants the runner to resume an existing provider session. */
  resumeRequested: boolean;
  /** Prompt text to forward to the SDK. */
  prompt: string;
  /** Turn id used to tag every emitted event. */
  turnId: string;
  /** Optional model override. */
  modelId?: string;
  /** Optional image attachments. */
  attachments?: PromptImageAttachment[];
  /**
   * Optional replay context (Task 14). Forwarded as-is when present so the
   * runner can rebuild a transcript on cold-start.
   */
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  /** Event sink wired to the broker → host channel. */
  onEvent: (event: BrokerToHost) => unknown;
  /** Optional abort signal — propagated to the underlying fetch. */
  signal?: AbortSignal;
}

function sign(body: string, ts: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

/**
 * POST a turn to the agent-runner's `/claude-sdk/turn` endpoint and forward
 * NDJSON events to `onEvent`. Resolves on stream end. Rejects on non-2xx
 * responses or fatal network errors. Malformed NDJSON lines are logged and
 * skipped without aborting the stream — the agent-runner emits well-formed
 * BrokerToHost events, so the bridge is mostly a pass-through.
 */
export async function runClaudeSdkTurn(opts: ClaudeSdkTurnOptions): Promise<void> {
  const body = JSON.stringify({
    sessionId: opts.sessionId,
    providerSessionId: opts.providerSessionId,
    resumeRequested: opts.resumeRequested,
    prompt: opts.prompt,
    turnId: opts.turnId,
    modelId: opts.modelId,
    attachments: opts.attachments,
    replayContext: opts.replayContext,
  });
  const ts = Date.now().toString();
  const sig = sign(body, ts, opts.hmacSecret);

  const res = await fetch(`${opts.runnerUrl.replace(/\/+$/, "")}/claude-sdk/turn`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-ts": ts,
      "x-runner-sig": sig,
    },
    body,
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`agent-runner returned ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.length > 0) {
          try {
            const event = JSON.parse(line) as BrokerToHost;
            await opts.onEvent(event);
          } catch (err) {
            // Malformed line — log to stderr and continue; never break the
            // stream on a single bad line.
            console.error("claude-sdk-bridge: skip malformed line", err);
          }
        }
        nl = buf.indexOf("\n");
      }
    }
    // Flush any trailing data without a terminating newline.
    const rest = (buf + decoder.decode()).trim();
    if (rest.length > 0) {
      try {
        await opts.onEvent(JSON.parse(rest) as BrokerToHost);
      } catch {
        /* ignore trailing malformed data */
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
