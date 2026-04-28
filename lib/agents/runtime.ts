import type { AgentRuntime as PrismaAgentRuntime } from "@prisma/client";
import type { AgentRuntime as ProtocolAgentRuntime } from "@wbd/protocol";

export const AGENT_RUNTIME_OPTIONS = [
  { value: "claude-code", label: "Claude Code", provider: "Anthropic" },
  { value: "openai-codex", label: "Codex", provider: "OpenAI" },
  { value: "vercel-ai", label: "Vercel AI", provider: "Vercel AI SDK" },
  { value: "openhands", label: "OpenHands", provider: "OpenHands SDK" },
] as const;

export type AppAgentRuntime = (typeof AGENT_RUNTIME_OPTIONS)[number]["value"];

const PROTOCOL_TO_DB: Record<ProtocolAgentRuntime, PrismaAgentRuntime> = {
  "claude-code": "CLAUDE_CODE",
  "openai-codex": "OPENAI_CODEX",
  "vercel-ai": "VERCEL_AI",
  openhands: "OPENHANDS",
};

const DB_TO_PROTOCOL: Record<PrismaAgentRuntime, ProtocolAgentRuntime> = {
  CLAUDE_CODE: "claude-code",
  OPENAI_CODEX: "openai-codex",
  VERCEL_AI: "vercel-ai",
  OPENHANDS: "openhands",
};

export function isAgentRuntime(value: string | undefined | null): value is AppAgentRuntime {
  return AGENT_RUNTIME_OPTIONS.some((option) => option.value === value);
}

export function protocolRuntimeToDb(runtime: ProtocolAgentRuntime): PrismaAgentRuntime {
  return PROTOCOL_TO_DB[runtime];
}

export function dbRuntimeToProtocol(runtime: PrismaAgentRuntime): ProtocolAgentRuntime {
  return DB_TO_PROTOCOL[runtime];
}

export function runtimeLabel(runtime: string | undefined | null): string {
  return AGENT_RUNTIME_OPTIONS.find((option) => option.value === runtime)?.label ?? "Unknown runtime";
}

export function runtimeProviderLabel(runtime: string | undefined | null): string | null {
  return AGENT_RUNTIME_OPTIONS.find((option) => option.value === runtime)?.provider ?? null;
}

export function defaultModelForRuntime(runtime: AppAgentRuntime): string | undefined {
  switch (runtime) {
    case "claude-code":
      return process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-6";
    case "openai-codex":
      return process.env.CODEX_MODEL?.trim() || "gpt-5.4";
    case "vercel-ai":
      return process.env.VERCEL_AI_MODEL?.trim() || "openai:gpt-5.2";
    case "openhands":
      return process.env.OPENHANDS_MODEL?.trim() || "openrouter:qwen/qwen3-coder:free";
  }
}
