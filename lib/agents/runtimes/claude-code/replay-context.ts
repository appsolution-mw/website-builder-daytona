/**
 * Builds the optional `replayContext` payload that the host attaches to every
 * claude-code turn dispatched through the broker → agent-runner. The agent-runner
 * uses the context only when SDK resume fails (Task 6); including it on every
 * turn keeps the fallback path always available without an extra round-trip.
 *
 * Spec: docs/superpowers/specs/2026-05-09-claude-agent-sdk-integration-design.md
 *       §4.3 + §7.
 *
 * Cap: last 20 messages (chronological order preserved).
 * Attachments are redacted to compact placeholders — the SDK only needs enough
 * shape to reconstruct a transcript; binary data does not flow through here.
 */

export interface MessageLike {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ name: string; sizeBytes: number }>;
}

export interface ReplayMessage {
  role: "user" | "assistant";
  text: string;
}

const MAX_REPLAY_MESSAGES = 20;

export function buildReplayContext(messages: MessageLike[]): ReplayMessage[] {
  const tail = messages.slice(-MAX_REPLAY_MESSAGES);
  return tail.map((m) => {
    const attachLine = (m.attachments ?? [])
      .map((a) => `[attachment ${a.name} (${a.sizeBytes} bytes)]`)
      .join(" ");
    const text = attachLine ? `${m.content}\n${attachLine}` : m.content;
    return { role: m.role, text };
  });
}
