import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrokerToHost } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";
import { parseOpenHandsBridgeLine } from "./openhands-bridge-events";
import type { SpawnFn, SpawnedChild } from "./claude-runner";

const OPENHANDS_BRIDGE_PATH = "/opt/builder/container/sandbox/broker/python/openhands_bridge.py";
const PROJECT_ROOT = "/workspace/project";
const OPENHANDS_ATTACHMENTS_DIR = ".agent-artifacts/openhands-attachments";
const DEFAULT_OPENHANDS_MODEL = "openrouter/qwen/qwen3-coder:free";
const DEFAULT_AGENTS_MD = `# AGENTS.md

## Project Context

- This project is a Next.js 16 App Router application running from \`/workspace/project\`.
- The preview renders the Next.js app, not a standalone HTML file.
- User-facing page work belongs in \`app/\`, \`components/\`, \`lib/\`, and \`public/\`.
- For the main page, edit \`app/page.tsx\` and related styles. Do not create or rely on a root \`index.html\` unless explicitly asked.
- This is not older Next.js: read the relevant guide in \`node_modules/next/dist/docs/\` before using framework APIs, routes, config, middleware/proxy, or runtime behavior.

## Commands

- Use \`pnpm\`.
- The sandbox manages the dev server. Do not start a second long-running server unless explicitly asked.
- Check TypeScript changes with \`pnpm exec tsc --noEmit\` when practical.

## Code Style

- Use TypeScript with strict types.
- Keep diffs small, focused, and maintainable.
- Prefer functional React components and App Router patterns.
- Preserve correct native spelling, including umlauts such as ä, ö, ü, and ß.
- Animations and parallax effects must be progressive enhancement: primary text, navigation, cards, and CTAs must remain visible in the server-rendered HTML/CSS fallback. Do not leave important content at \`opacity: 0\` waiting for client-side animation or hydration.
`;
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";

export type OpenHandsSpawnFn = SpawnFn;

export interface OpenHandsRunnerDeps {
  spawn?: OpenHandsSpawnFn;
}

export function normalizeOpenHandsModelId(modelId: string | undefined): string {
  if (!modelId) return "";
  const trimmed = modelId.trim();
  return trimmed.startsWith("openrouter:") ? `openrouter/${trimmed.slice("openrouter:".length)}` : trimmed;
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
    LLM_BASE_URL: env.LLM_BASE_URL || env.OPENHANDS_BASE_URL || "https://openrouter.ai/api/v1",
    OPENHANDS_MAX_ITERATIONS: env.OPENHANDS_MAX_ITERATIONS || "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: env.OPENHANDS_ENABLE_PUBLIC_SKILLS || "0",
  };
}

function spawnBridge(args: {
  sessionId: string;
  prompt: string;
  model: string;
  attachmentsManifestPath?: string;
  conversationId?: string;
  persistenceDir?: string;
  deps: OpenHandsRunnerDeps;
}): SpawnedChild {
  const spawnFn: OpenHandsSpawnFn = args.deps.spawn ?? (nodeSpawn as unknown as OpenHandsSpawnFn);
  const argv = [
    OPENHANDS_BRIDGE_PATH,
    "--session",
    args.sessionId,
    "--workspace",
    PROJECT_ROOT,
    "--model",
    args.model,
    "--prompt",
    args.prompt,
  ];
  if (args.attachmentsManifestPath) {
    argv.push("--attachments-manifest", args.attachmentsManifestPath);
  }
  if (args.conversationId) {
    argv.push("--conversation-id", args.conversationId);
  }
  if (args.persistenceDir) {
    argv.push("--persistence-dir", args.persistenceDir);
  }

  return spawnFn("python3", argv, {
    cwd: PROJECT_ROOT,
    env: bridgeEnv(args.model),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function imageDataUrl(mimeType: string, dataBase64: string): string {
  return `data:${mimeType};base64,${dataBase64}`;
}

function safeManifestName(turnId: string): string {
  const stem = turnId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "turn"}.json`;
}

async function writeAttachmentsManifest(
  projectRoot: string | undefined,
  turnId: string,
  attachments: AgentTurnOptions["attachments"],
): Promise<string | undefined> {
  if (!attachments || attachments.length === 0) return undefined;

  const root = projectRoot || PROJECT_ROOT;
  const dir = join(root, OPENHANDS_ATTACHMENTS_DIR);
  await mkdir(dir, { recursive: true });
  const path = join(dir, safeManifestName(turnId));
  const manifest = {
    imageUrls: attachments.map((attachment) =>
      imageDataUrl(attachment.mimeType, attachment.dataBase64),
    ),
  };
  await writeFile(path, `${JSON.stringify(manifest)}\n`, "utf8");
  return path;
}

async function ensureAgentsMd(projectRoot: string | undefined): Promise<void> {
  const root = projectRoot || PROJECT_ROOT;
  const path = join(root, "AGENTS.md");

  try {
    await readFile(path, "utf8");
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") return;
  }

  try {
    await writeFile(path, DEFAULT_AGENTS_MD, "utf8");
  } catch {
    // OpenHands can still run without this file; the UI also backfills it when possible.
  }
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
  onEvent: (event: BrokerToHost) => unknown;
  model: string;
  agentId?: string;
}): Promise<void> {
  return Promise.resolve(opts.onEvent({
    type: "agent.error",
    turnId: opts.turnId,
    message: missingApiKeyMessage(opts.model),
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  })).then(() => undefined);
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
  onEvent: (event: BrokerToHost) => unknown;
  signal?: AbortSignal;
  mapEvent?: (event: BrokerToHost) => BrokerToHost;
}): Promise<void> {
  const mapEvent = args.mapEvent ?? ((event: BrokerToHost) => event);
  let sawTerminal = false;
  let aborted = false;
  let stderrTail = "";
  let eventError: unknown;

  let eventChain = Promise.resolve();
  const emit = (event: BrokerToHost) => {
    if (event.type === "agent.done" || event.type === "agent.error") sawTerminal = true;
    eventChain = eventChain.then(async () => {
      await args.onEvent(mapEvent(event));
    });
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
    if (args.signal.aborted) onAbort();
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
      void eventChain.then(finish, (error: unknown) => {
        eventError = error;
        finish();
      });
    });

    args.child.once("error", (err) => {
      if (!sawTerminal) {
        emit({
          type: "agent.error",
          turnId: args.turnId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      void eventChain.then(finish, (error: unknown) => {
        eventError = error;
        finish();
      });
    });
  });
  if (eventError !== undefined) {
    throw eventError;
  }
}

export async function runOpenHandsTurn(
  opts: AgentTurnOptions,
  deps: OpenHandsRunnerDeps = {},
): Promise<void> {
  const model = openHandsModel(opts.modelId, "OPENHANDS_MODEL");

  if (!bridgeApiKeyAvailable()) {
    await emitMissingApiKey({ ...opts, model });
    return;
  }

  await ensureAgentsMd(opts.projectRoot);
  const attachmentsManifestPath = await writeAttachmentsManifest(
    opts.projectRoot,
    opts.turnId,
    opts.attachments,
  );

  const child = spawnBridge({
    sessionId: opts.sessionId,
    prompt: opts.prompt,
    model,
    attachmentsManifestPath,
    conversationId: opts.run?.conversationId,
    persistenceDir: opts.run?.persistenceDir,
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
    await emitMissingApiKey({ ...opts, model, agentId: "reviewer" });
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
