import type { AgentConfigMode, EnablementState } from "./types";

const MAX_MARKDOWN_BYTES = 128 * 1024;
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const AGENT_CONFIG_MODES = new Set<AgentConfigMode>(["INHERIT", "EXTEND", "REPLACE"]);
const ENABLEMENT_STATES = new Set<EnablementState>(["ENABLED", "DISABLED", "INHERITED"]);

export function assertSafeAgentConfigName(name: string): void {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error("Name must use lowercase letters, numbers, and hyphens.");
  }
}

export function assertMarkdownSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_MARKDOWN_BYTES) {
    throw new Error("Markdown content is too large.");
  }
}

export function isAgentConfigMode(value: unknown): value is AgentConfigMode {
  return typeof value === "string" && AGENT_CONFIG_MODES.has(value as AgentConfigMode);
}

export function isEnablementState(value: unknown): value is EnablementState {
  return typeof value === "string" && ENABLEMENT_STATES.has(value as EnablementState);
}

export function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
