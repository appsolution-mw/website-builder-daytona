import { createSimpleScheduler } from "../scheduler/simple";
import { createFakeProvisioner } from "../provisioner/fake";
import { createAgentClient } from "./agent-client";
import { createWorkerPoolRuntime } from "./runtime";
import type { Runtime, WorkerRecord } from "../types";
import type { AgentClient } from "./types";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OPENROUTER_ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
const DEFAULT_WORKER_AGENT_TIMEOUT_MS = 120_000;

export interface CreateLocalWorkerPoolRuntimeArgs {
  sandboxImage?: string;
  hmacSecret?: string;
}

/**
 * Convenience factory for `RUNTIME_MODE=worker-pool-local`. Wires:
 *   - SimpleScheduler  (DB-backed)
 *   - FakeProvisioner  (in-memory)
 *   - HTTP AgentClient against WORKER_AGENT_URL, falling back to worker.tailscaleIp:4500
 *   - brokerEnv passes through agent credentials so the in-container broker
 *     can authenticate the chosen agent runtime (claude-code / codex / etc.)
 */
export function createLocalWorkerPoolRuntime(args: CreateLocalWorkerPoolRuntimeArgs = {}): Runtime {
  const runtimeEnv = collectRuntimeEnv();
  const sandboxImage = args.sandboxImage ?? required("SANDBOX_IMAGE", runtimeEnv);
  const hmacSecret = args.hmacSecret ?? required("WORKER_AGENT_HMAC_SECRET", runtimeEnv);
  const configuredAgentUrl = optionalUrl("WORKER_AGENT_URL", runtimeEnv);
  const timeoutMs = optionalPositiveInt("WORKER_AGENT_TIMEOUT_MS", runtimeEnv) ??
    DEFAULT_WORKER_AGENT_TIMEOUT_MS;
  const scheduler = createSimpleScheduler();
  const provisioner = createFakeProvisioner();
  const agentClientFor = (w: WorkerRecord): AgentClient =>
    createAgentClient({
      baseUrl: configuredAgentUrl?.origin ?? `http://${w.tailscaleIp}:4500`,
      hmacSecret,
      timeoutMs,
    });
  return createWorkerPoolRuntime({
    scheduler,
    provisioner,
    agentClientFor,
    sandboxImage,
    brokerEnv: () => collectBrokerEnv(collectRuntimeEnv()),
    publicHostFor: configuredAgentUrl ? () => configuredAgentUrl.hostname : undefined,
  });
}

export function collectBrokerEnv(runtimeEnv: Record<string, string> = collectRuntimeEnv()): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = [
    "AGENT_RUNTIME",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_MODEL",
    "CLAUDE_REVIEWER_MODEL",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_MODEL",
    "CODEX_REVIEWER_MODEL",
    "CODEX_REASONING_EFFORT",
    "CODEX_REVIEWER_REASONING_EFFORT",
    "CODEX_SANDBOX_MODE",
    "CODEX_REVIEWER_SANDBOX_MODE",
    "CODEX_NETWORK_ACCESS",
    "OPENROUTER_API_KEY",
    "OPENHANDS_MODEL",
    "OPENHANDS_REVIEWER_MODEL",
    "OPENHANDS_BASE_URL",
    "OPENHANDS_MAX_ITERATIONS",
    "OPENHANDS_ENABLE_PUBLIC_SKILLS",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "VERCEL_AI_MODEL",
    "VERCEL_AI_REVIEWER_MODEL",
    "GITHUB_CLONE_TOKEN",
    "GITHUB_REPO_OWNER",
    "GITHUB_REPO_NAME",
  ];
  for (const k of passthrough) {
    const v = runtimeEnv[k];
    if (v) env[k] = v;
  }
  if (!env.ANTHROPIC_API_KEY && runtimeEnv.OPENROUTER_API_KEY) {
    env.ANTHROPIC_API_KEY = runtimeEnv.OPENROUTER_API_KEY;
  }
  if (!env.ANTHROPIC_BASE_URL && runtimeEnv.OPENROUTER_API_KEY && !runtimeEnv.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_BASE_URL = OPENROUTER_ANTHROPIC_BASE_URL;
  }
  return env;
}

function collectRuntimeEnv(): Record<string, string> {
  if (process.env.WBD_DISABLE_ENV_FILE_LOAD === "1") {
    return processEnvStrings();
  }
  return {
    ...processEnvStrings(),
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local"),
  };
}

function processEnvStrings(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function readEnvFile(fileName: string): Record<string, string> {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = unquoteEnvValue(rawValue.trim());
  }
  return env;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const commentStart = value.search(/\s#/);
  return commentStart === -1 ? value : value.slice(0, commentStart).trimEnd();
}

function required(name: string, runtimeEnv: Record<string, string>): string {
  const v = runtimeEnv[name];
  if (!v) throw new Error(`worker-pool runtime requires env: ${name}`);
  return v;
}

function optionalUrl(name: string, runtimeEnv: Record<string, string>): URL | null {
  const value = runtimeEnv[name];
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    throw new Error(`worker-pool runtime requires ${name} to be a valid URL`);
  }
}

function optionalPositiveInt(name: string, runtimeEnv: Record<string, string>): number | null {
  const value = runtimeEnv[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`worker-pool runtime requires ${name} to be a positive integer`);
  }
  return parsed;
}

export { createWorkerPoolRuntime } from "./runtime";
export { createAgentClient } from "./agent-client";
export { createFakeAgentClient } from "./fake-agent-client";
export type * from "./types";
