import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as pty from "node-pty";
import type { BrokerToHost } from "@wbd/protocol";

const TERMINAL_ABORT_GRACE_MS = 1500;

export interface TerminalCommandHandle {
  requestId: string;
  done: Promise<void>;
  abort: () => void;
}

export type PtySpawnFn = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: string;
    cols: number;
    rows: number;
  },
) => {
  pid: number;
  onData: (listener: (data: string) => void) => { dispose: () => void };
  onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  resize: (cols: number, rows: number) => void;
  write: (data: string | Buffer) => void;
  kill: (signal?: string) => void;
};

export interface InteractiveTerminalHandle {
  requestId: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export interface StartTerminalCommandOptions {
  requestId: string;
  command: string;
  cwd: string;
  onEvent: (event: BrokerToHost) => void;
}

export interface StartInteractiveTerminalOptions {
  requestId: string;
  cwd: string;
  cols: number;
  rows: number;
  onEvent: (event: BrokerToHost) => void;
  spawn?: PtySpawnFn;
}

function defaultInteractiveShell(): { shell: string; args: string[] } {
  if (existsSync("/bin/bash")) return { shell: "/bin/bash", args: ["-i"] };
  const shell = process.env.SHELL || "/bin/sh";
  return { shell, args: [] };
}

export function startTerminalCommand(opts: StartTerminalCommandOptions): TerminalCommandHandle {
  const child = nodeSpawn(opts.command, [], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
      TERM: process.env.TERM ?? "xterm-256color",
    },
    shell: process.env.SHELL || "/bin/sh",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let aborted = false;
  let settled = false;
  let killTimer: NodeJS.Timeout | null = null;

  const emitExit = (event: Extract<BrokerToHost, { type: "terminal.exit" }>) => {
    if (settled) return;
    settled = true;
    if (killTimer) clearTimeout(killTimer);
    opts.onEvent(event);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    opts.onEvent({
      type: "terminal.output",
      requestId: opts.requestId,
      stream: "stdout",
      data: chunk.toString("utf8"),
    });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    opts.onEvent({
      type: "terminal.output",
      requestId: opts.requestId,
      stream: "stderr",
      data: chunk.toString("utf8"),
    });
  });

  const done = new Promise<void>((resolve) => {
    child.once("error", (err) => {
      emitExit({
        type: "terminal.exit",
        requestId: opts.requestId,
        ok: false,
        exitCode: null,
        signal: null,
        reason: "spawn_error",
        error: err.message,
      });
      resolve();
    });

    child.once("close", (code, signal) => {
      emitExit({
        type: "terminal.exit",
        requestId: opts.requestId,
        ok: !aborted && code === 0,
        exitCode: code,
        signal,
        ...(aborted ? { reason: "aborted" as const } : {}),
      });
      resolve();
    });
  });

  return {
    requestId: opts.requestId,
    done,
    abort: () => {
      if (settled || aborted) return;
      aborted = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, TERMINAL_ABORT_GRACE_MS);
    },
  };
}

function normalizeSize(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function startInteractiveTerminal(opts: StartInteractiveTerminalOptions): InteractiveTerminalHandle {
  const { shell, args } = defaultInteractiveShell();
  const cols = normalizeSize(opts.cols, 80);
  const rows = normalizeSize(opts.rows, 24);
  const spawnFn = opts.spawn ?? pty.spawn;
  const term = spawnFn(shell, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      PS1: "\\w $ ",
    },
    name: "xterm-256color",
    cols,
    rows,
  });

  let closed = false;
  const dataSubscription = term.onData((data) => {
    opts.onEvent({
      type: "terminal.output",
      requestId: opts.requestId,
      stream: "stdout",
      data,
    });
  });
  const exitSubscription = term.onExit((event) => {
    closed = true;
    dataSubscription.dispose();
    exitSubscription.dispose();
    opts.onEvent({
      type: "terminal.exit",
      requestId: opts.requestId,
      ok: event.exitCode === 0,
      exitCode: event.exitCode,
      signal: event.signal === undefined ? null : String(event.signal),
    });
  });

  opts.onEvent({
    type: "terminal.ready",
    requestId: opts.requestId,
    pid: term.pid,
    shell,
  });

  return {
    requestId: opts.requestId,
    write: (data: string) => {
      if (!closed) term.write(data);
    },
    resize: (nextCols: number, nextRows: number) => {
      if (!closed) term.resize(normalizeSize(nextCols, cols), normalizeSize(nextRows, rows));
    },
    close: () => {
      if (closed) return;
      term.kill();
    },
  };
}
