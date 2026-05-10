import type { AgentRuntime as PrismaAgentRuntime } from "@prisma/client";
import type { AgentRuntime as ProtocolAgentRuntime } from "@wbd/protocol";

// User-pickable runtimes in the UI dropdown. OpenHands is intentionally
// hidden — its enum value, DB rows, and Map entries below stay so existing
// projects/sessions keep rendering, but the picker only offers the two
// active runtimes.
export const AGENT_RUNTIME_OPTIONS = [
  { value: "claude-code", label: "Claude Code", provider: "Anthropic" },
  { value: "openai-codex", label: "Codex", provider: "OpenAI" },
] as const;

// AppAgentRuntime mirrors the wire/DB enum so callers that read existing
// rows or map between Prisma and protocol stay typesafe regardless of which
// runtimes the picker currently exposes.
export type AppAgentRuntime = ProtocolAgentRuntime;

const PROTOCOL_TO_DB: Record<ProtocolAgentRuntime, PrismaAgentRuntime> = {
  "claude-code": "CLAUDE_CODE",
  "openai-codex": "OPENAI_CODEX",
  openhands: "OPENHANDS",
};

const DB_TO_PROTOCOL: Record<PrismaAgentRuntime, ProtocolAgentRuntime> = {
  CLAUDE_CODE: "claude-code",
  OPENAI_CODEX: "openai-codex",
  OPENHANDS: "openhands",
};

export function isAgentRuntime(value: string | undefined | null): value is AppAgentRuntime {
  return value === "claude-code" || value === "openai-codex" || value === "openhands";
}

export function protocolRuntimeToDb(runtime: ProtocolAgentRuntime): PrismaAgentRuntime {
  return PROTOCOL_TO_DB[runtime];
}

export function dbRuntimeToProtocol(runtime: PrismaAgentRuntime): ProtocolAgentRuntime {
  return DB_TO_PROTOCOL[runtime];
}

// Labels for every wire-format runtime — including ones currently hidden
// from the picker — so historical projects/sessions still render correctly.
const RUNTIME_LABELS: Record<ProtocolAgentRuntime, { label: string; provider: string }> = {
  "claude-code": { label: "Claude Code", provider: "Anthropic" },
  "openai-codex": { label: "Codex", provider: "OpenAI" },
  openhands: { label: "OpenHands", provider: "OpenHands SDK" },
};

export function runtimeLabel(runtime: string | undefined | null): string {
  if (runtime && runtime in RUNTIME_LABELS) {
    return RUNTIME_LABELS[runtime as ProtocolAgentRuntime].label;
  }
  return "Unknown runtime";
}

export function runtimeProviderLabel(runtime: string | undefined | null): string | null {
  if (runtime && runtime in RUNTIME_LABELS) {
    return RUNTIME_LABELS[runtime as ProtocolAgentRuntime].provider;
  }
  return null;
}

export function defaultModelForRuntime(runtime: AppAgentRuntime): string | undefined {
  switch (runtime) {
    case "claude-code":
      return process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6";
    case "openai-codex":
      return process.env.CODEX_MODEL?.trim() || "gpt-5.4";
    case "openhands":
      return process.env.OPENHANDS_MODEL?.trim() || "openrouter:google/gemini-2.5-flash";
  }
}
