/**
 * Resume detection helpers for the Claude Agent SDK runner.
 *
 * The SDK's `query()` resumes a session via the `resume` option, but if the
 * underlying JSONL transcript is missing (e.g. sandbox restarted, fresh
 * volume) the SDK silently starts a brand-new session and returns a different
 * `session_id` in `system.init`. We detect that case by comparing the
 * requested provider session id with the one the SDK actually emitted.
 *
 * When detection reports `resumed: false`, the runner falls back to a
 * synthetic conversation primer (DB replay) that is prepended to the user's
 * new prompt, so the model has the prior turns as context.
 */

export function detectResumeOutcome(args: {
  requested: string;
  got: string;
}): { resumed: boolean } {
  return { resumed: args.requested === args.got };
}

export interface ReplayMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Build a single string prompt that prepends the prior conversation history
 * (replay context) before the current user message. When `replayContext` is
 * empty the original prompt is returned unchanged.
 */
export function buildReplayPrompt(args: {
  replayContext: ReplayMessage[];
  prompt: string;
}): string {
  if (args.replayContext.length === 0) return args.prompt;
  const lines: string[] = ["[Previous conversation]"];
  for (const m of args.replayContext) lines.push(`${m.role}: ${m.text}`);
  lines.push("", "[Current message]", args.prompt);
  return lines.join("\n");
}
