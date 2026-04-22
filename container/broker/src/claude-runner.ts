import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { BrokerToHost } from "@wbd/protocol";
import { parseNdjsonLine, createTaskMap } from "./ndjson-parser";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MODEL = "claude-sonnet-4-6";
const MINIMAL_TERMINAL_PROMPT = [
  "You are operating in minimal terminal mode.",
  "Only output short status updates.",
  "No explanations unless asked.",
  "No code unless explicitly requested.",
  "Prefer one-line updates.",
  "Do not list files you read or edited.",
  "Do not emit one status line per file or tool call; group routine progress.",
  'Examples: "Working on it...", "Updating the project...", "Checking progress...", "Done".',
].join("\n");

const REVIEWER_MODEL = "claude-sonnet-4-6";
const REVIEWER_PROMPT =
  "Invoke the reviewer sub-agent on the uncommitted changes from this turn. Output only a short status or concise issue bullets.";
const REVIEWER_DEFAULT_TIMEOUT_MS = 90 * 1000;

function timeoutFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackMs;
}

function formatTimeout(ms: number): string {
  if (ms === 0) return "no timeout";
  const mins = ms / 60_000;
  if (mins >= 1) return `${Number.isInteger(mins) ? mins : mins.toFixed(1)} minutes`;
  const secs = ms / 1000;
  return `${Number.isInteger(secs) ? secs : secs.toFixed(1)} seconds`;
}

export interface ClaudeRunnerOptions {
  projectId: string;
  claudeSessionId: string;
  resumeClaudeSession: boolean;
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
 * Spawn `claude --print` and stream its NDJSON output as protocol events.
 * Resolves (never rejects) on any termination path — success, error, or abort.
 */
export async function runClaudeTurn(
  opts: ClaudeRunnerOptions,
  deps: ClaudeRunnerDeps = {},
): Promise<void> {
  const spawnFn: SpawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const timeoutMs = opts.timeoutMs ?? timeoutFromEnv("CLAUDE_TURN_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

  const argv = [
    "--print",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    MINIMAL_TERMINAL_PROMPT,
    opts.resumeClaudeSession ? "--resume" : "--session-id",
    opts.claudeSessionId,
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
  let timedOut = false;
  let stderrTail = "";

  const emit = (e: BrokerToHost) => {
    if (e.type === "agent.done" || e.type === "agent.error") sawResult = true;
    opts.onEvent(e);
  };

  const killChild = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  };

  const timeout = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutMs)
    : null;
  timeout?.unref();

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
      killChild();
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
      if (timeout) clearTimeout(timeout);
      if (buffer.trim()) {
        for (const event of parseNdjsonLine(buffer, opts.turnId, taskMap)) emit(event);
      }
      if (timedOut && !sawResult) {
        emit({
          type: "agent.error",
          turnId: opts.turnId,
          message: `Claude timed out after ${formatTimeout(timeoutMs)}. Increase CLAUDE_TURN_TIMEOUT_MS for longer tasks.`,
        });
      } else if (aborted) {
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
      if (timeout) clearTimeout(timeout);
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
  const timeoutMs = opts.timeoutMs ?? timeoutFromEnv("CLAUDE_REVIEWER_TIMEOUT_MS", REVIEWER_DEFAULT_TIMEOUT_MS);

  const sessionId = randomUUID();

  const argv = [
    "--print",
    REVIEWER_PROMPT,
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    MINIMAL_TERMINAL_PROMPT,
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
  let sawResult = false;
  let aborted = false;
  let timedOut = false;
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
  const emit = (e: BrokerToHost) => {
    if (e.type === "agent.done" || e.type === "agent.error") sawResult = true;
    opts.onEvent(tagReviewer(e));
  };

  const killChild = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  };

  const timeout = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutMs)
    : null;
  timeout?.unref();

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
      killChild();
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
      if (timeout) clearTimeout(timeout);
      resolve();
    };

    child.once("close", (code) => {
      // Node guarantees 'close' fires after 'error'; skip double work if we
      // already resolved from the error path.
      if (resolved) {
        if (timeout) clearTimeout(timeout);
        return;
      }
      if (buffer.trim()) {
        for (const event of parseNdjsonLine(buffer, opts.turnId, taskMap)) emit(event);
      }
      if (timedOut && !sawResult) {
        emit({
          type: "agent.error",
          turnId: opts.turnId,
          message: `Reviewer timed out after ${formatTimeout(timeoutMs)}. Increase CLAUDE_REVIEWER_TIMEOUT_MS for longer reviews.`,
        });
      } else if (aborted) {
        emit({
          type: "agent.done",
          turnId: opts.turnId,
          durationMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          exitCode: -1,
        });
      } else if (!sawResult && code !== 0 && code !== null) {
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
