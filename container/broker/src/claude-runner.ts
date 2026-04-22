import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { BrokerToHost } from "@wbd/protocol";
import { parseNdjsonLine, createTaskMap } from "./ndjson-parser";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MODEL = "claude-sonnet-4-6";

const REVIEWER_MODEL = "claude-sonnet-4-6";
const REVIEWER_PROMPT =
  "Invoke the reviewer sub-agent on the uncommitted changes from this turn. Output only the review note.";
const REVIEWER_DEFAULT_TIMEOUT_MS = 90 * 1000;

export interface ClaudeRunnerOptions {
  projectId: string;
  prompt: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Minimal child-process shape that the runner needs at runtime. */
export interface SpawnedChild {
  stdout: Readable | null;
  stderr: Readable | null;
  stdin: Writable | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once(event: "close", listener: (code: number | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
}

/** Spawn factory — accepts the real `nodeSpawn` or a test fake. */
export type SpawnFn = (
  cmd: string,
  args: string[],
  options: Parameters<typeof nodeSpawn>[2],
) => SpawnedChild;

export interface ClaudeRunnerDeps {
  spawn?: SpawnFn;
}

/**
 * Build a stable session-id (Claude Code requires valid UUID v4 format).
 * We derive one from the projectId via a deterministic fallback: if projectId
 * is already a UUID, use it; else generate a fresh one (session won't persist
 * across turns for non-UUID projectIds, but that's acceptable for MVP).
 */
function sessionIdFor(projectId: string): string {
  // Simple UUID-v4 regex check
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)
  ) {
    return projectId;
  }
  return randomUUID();
}

/**
 * Spawn `claude --print` and stream its NDJSON output as protocol events.
 * Resolves (never rejects) on any termination path — success, error, or abort.
 */
export async function runClaudeTurn(
  opts: ClaudeRunnerOptions,
  deps: ClaudeRunnerDeps = {},
): Promise<void> {
  const spawnFn: SpawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const argv = [
    "--print",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--session-id",
    sessionIdFor(opts.projectId),
    "--model",
    MODEL,
    // --dangerously-skip-permissions is blocked when running as root (Daytona
    // containers run as root).  --permission-mode acceptEdits lets Claude edit
    // files without interactive confirmation, which is equivalent for our
    // sandboxed use-case.
    "--permission-mode",
    "acceptEdits",
  ];

  const child: SpawnedChild = spawnFn("claude", argv, {
    cwd: "/workspace/project",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let sawResult = false;
  let aborted = false;
  let stderrTail = "";

  const emit = (e: BrokerToHost) => {
    if (e.type === "agent.done" || e.type === "agent.error") sawResult = true;
    opts.onEvent(e);
  };

  const timeout = setTimeout(() => {
    aborted = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  }, timeoutMs);
  timeout.unref();

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    });
  }

  const taskMap = createTaskMap();

  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      for (const event of parseNdjsonLine(line, opts.turnId, taskMap)) emit(event);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
  });

  await new Promise<void>((resolve) => {
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (buffer.trim()) {
        for (const event of parseNdjsonLine(buffer, opts.turnId, taskMap)) emit(event);
      }
      if (aborted) {
        emit({
          type: "agent.done",
          turnId: opts.turnId,
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          exitCode: -1,
        });
      } else if (!sawResult) {
        emit({
          type: "agent.error",
          turnId: opts.turnId,
          message: `claude exited with code ${code ?? "unknown"}${stderrTail ? `\n${stderrTail}` : ""}`,
        });
      }
      resolve();
    });
    child.once("error", (err) => {
      clearTimeout(timeout);
      if (!sawResult) {
        emit({
          type: "agent.error",
          turnId: opts.turnId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      resolve();
    });
  });
}

export interface ReviewerRunnerOptions {
  projectId: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function runReviewerPass(
  opts: ReviewerRunnerOptions,
  deps: ClaudeRunnerDeps = {},
): Promise<void> {
  const spawnFn: SpawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const timeoutMs = opts.timeoutMs ?? REVIEWER_DEFAULT_TIMEOUT_MS;

  const sessionId = randomUUID();

  const argv = [
    "--print",
    REVIEWER_PROMPT,
    "--output-format",
    "stream-json",
    "--verbose",
    "--session-id",
    sessionId,
    "--model",
    REVIEWER_MODEL,
    "--permission-mode",
    "acceptEdits",
    "--add-dir",
    "/workspace/project",
  ];

  const child: SpawnedChild = spawnFn("claude", argv, {
    cwd: "/workspace/project",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const taskMap = createTaskMap();
  let aborted = false;
  let stderrTail = "";

  const tagReviewer = (e: BrokerToHost): BrokerToHost => {
    if (
      e.type === "agent.chunk" ||
      e.type === "agent.status" ||
      e.type === "agent.tool_use" ||
      e.type === "agent.error"
    ) {
      return { ...e, agentId: "reviewer" } as BrokerToHost;
    }
    return e;
  };
  const emit = (e: BrokerToHost) => opts.onEvent(tagReviewer(e));

  const timeout = setTimeout(() => {
    aborted = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  }, timeoutMs);
  timeout.unref();

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    });
  }

  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      for (const event of parseNdjsonLine(line, opts.turnId, taskMap)) emit(event);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
  });

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve();
    };

    child.once("close", (code) => {
      if (buffer.trim()) {
        for (const event of parseNdjsonLine(buffer, opts.turnId, taskMap)) emit(event);
      }
      if (aborted) {
        emit({
          type: "agent.done",
          turnId: opts.turnId,
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          exitCode: -1,
        });
      } else if (code !== 0 && code !== null) {
        emit({
          type: "agent.error",
          turnId: opts.turnId,
          message: `reviewer exited with code ${code}${stderrTail ? `\n${stderrTail}` : ""}`,
        });
      }
      finish();
    });
    child.once("error", (err) => {
      emit({
        type: "agent.error",
        turnId: opts.turnId,
        message: err instanceof Error ? err.message : String(err),
      });
      finish();
    });
  });
}
