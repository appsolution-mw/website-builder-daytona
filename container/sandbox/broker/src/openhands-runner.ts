import { spawn as nodeSpawn } from "node:child_process";
import type { BrokerToHost } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";
import { parseOpenHandsBridgeLine } from "./openhands-bridge-events";
import type { SpawnFn, SpawnedChild } from "./claude-runner";

const OPENHANDS_BRIDGE_PATH = "/opt/builder/container/sandbox/broker/python/openhands_bridge.py";
const DEFAULT_OPENHANDS_MODEL = "openrouter/qwen/qwen3-coder:free";
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";

export type OpenHandsSpawnFn = SpawnFn;

export interface OpenHandsRunnerDeps {
  spawn?: OpenHandsSpawnFn;
}

export function normalizeOpenHandsModelId(modelId: string | undefined): string {
  if (!modelId) return "";
  return modelId.startsWith("openrouter:") ? `openrouter/${modelId.slice("openrouter:".length)}` : modelId;
}

function isOpenRouterModel(modelId: string): boolean {
  return modelId.startsWith("openrouter/");
}

function openHandsModel(modelId: string | undefined, envName: string): string {
  return normalizeOpenHandsModelId(
    modelId || process.env[envName] || process.env.OPENHANDS_MODEL || DEFAULT_OPENHANDS_MODEL,
  );
}

function bridgeEnv(model: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    LLM_MODEL: model,
    LLM_API_KEY: env.LLM_API_KEY || env.OPENROUTER_API_KEY || "",
    LLM_BASE_URL: env.OPENHANDS_BASE_URL || env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
    OPENHANDS_MAX_ITERATIONS: env.OPENHANDS_MAX_ITERATIONS || "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: env.OPENHANDS_ENABLE_PUBLIC_SKILLS || "0",
  };
}

function spawnBridge(args: {
  sessionId: string;
  prompt: string;
  model: string;
  deps: OpenHandsRunnerDeps;
}): SpawnedChild {
  const spawnFn: OpenHandsSpawnFn = args.deps.spawn ?? (nodeSpawn as unknown as OpenHandsSpawnFn);
  const argv = [
    OPENHANDS_BRIDGE_PATH,
    "--session",
    args.sessionId,
    "--workspace",
    "/workspace/project",
    "--model",
    args.model,
    "--prompt",
    args.prompt,
  ];

  return spawnFn("python3", argv, {
    cwd: "/workspace/project",
    env: bridgeEnv(args.model),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function bridgeApiKeyAvailable(): boolean {
  return Boolean(process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY);
}

function missingApiKeyMessage(model: string): string {
  return isOpenRouterModel(model)
    ? "openhands runtime requires OPENROUTER_API_KEY or LLM_API_KEY for OpenRouter models."
    : "openhands runtime requires LLM_API_KEY or OPENROUTER_API_KEY.";
}

function emitMissingApiKey(opts: {
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
  model: string;
  agentId?: string;
}): void {
  opts.onEvent({
    type: "agent.error",
    turnId: opts.turnId,
    message: missingApiKeyMessage(opts.model),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  });
}

function tagReviewer(event: BrokerToHost): BrokerToHost {
  if (
    event.type === "agent.chunk" ||
    event.type === "agent.status" ||
    event.type === "agent.tool_use" ||
    event.type === "agent.error"
  ) {
    return { ...event, agentId: "reviewer" } as BrokerToHost;
  }
  return event;
}

async function runBridge(args: {
  child: SpawnedChild;
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
  mapEvent?: (event: BrokerToHost) => BrokerToHost;
}): Promise<void> {
  const mapEvent = args.mapEvent ?? ((event: BrokerToHost) => event);
  let sawTerminal = false;
  let aborted = false;
  let stderrTail = "";

  const emit = (event: BrokerToHost) => {
    if (event.type === "agent.done" || event.type === "agent.error") sawTerminal = true;
    args.onEvent(mapEvent(event));
  };

  const killChild = () => {
    args.child.kill("SIGTERM");
    setTimeout(() => args.child.kill("SIGKILL"), 2000).unref();
  };

  let onAbort: (() => void) | undefined;
  if (args.signal) {
    onAbort = () => {
      aborted = true;
      killChild();
    };
    args.signal.addEventListener("abort", onAbort);
  }

  let buffer = "";
  args.child.stdout?.setEncoding("utf8");
  args.child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const event = parseOpenHandsBridgeLine(line, args.turnId);
      if (event) emit(event);
    }
  });

  args.child.stderr?.setEncoding("utf8");
  args.child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
  });

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (args.signal && onAbort) args.signal.removeEventListener("abort", onAbort);
      resolve();
    };

    args.child.once("close", (code) => {
      if (buffer.trim()) {
        const event = parseOpenHandsBridgeLine(buffer, args.turnId);
        if (event) emit(event);
      }

      if (aborted && !sawTerminal) {
        emit({
          type: "agent.done",
          turnId: args.turnId,
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          exitCode: -1,
        });
      } else if (!sawTerminal) {
        emit({
          type: "agent.error",
          turnId: args.turnId,
          message: `openhands bridge exited without terminal event (code ${code ?? "unknown"})${
            stderrTail ? `\n${stderrTail}` : ""
          }`,
        });
      }
      finish();
    });

    args.child.once("error", (err) => {
      if (!sawTerminal) {
        emit({
          type: "agent.error",
          turnId: args.turnId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      finish();
    });
  });
}

export async function runOpenHandsTurn(
  opts: AgentTurnOptions,
  deps: OpenHandsRunnerDeps = {},
): Promise<void> {
  const model = openHandsModel(opts.modelId, "OPENHANDS_MODEL");

  if (!bridgeApiKeyAvailable()) {
    emitMissingApiKey({ ...opts, model });
    return;
  }

  const child = spawnBridge({
    sessionId: opts.sessionId,
    prompt: opts.prompt,
    model,
    deps,
  });

  await runBridge({
    child,
    turnId: opts.turnId,
    onEvent: opts.onEvent,
    signal: opts.signal,
  });
}

export async function runOpenHandsReviewPass(
  opts: AgentReviewOptions,
  deps: OpenHandsRunnerDeps = {},
): Promise<void> {
  const model = openHandsModel(undefined, "OPENHANDS_REVIEWER_MODEL");

  if (!bridgeApiKeyAvailable()) {
    emitMissingApiKey({ ...opts, model, agentId: "reviewer" });
    return;
  }

  const child = spawnBridge({
    sessionId: `review-${opts.turnId}`,
    prompt: REVIEWER_PROMPT,
    model,
    deps,
  });

  await runBridge({
    child,
    turnId: opts.turnId,
    onEvent: opts.onEvent,
    signal: opts.signal,
    mapEvent: tagReviewer,
  });
}
