import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { BrokerToHost } from "@wbd/protocol";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LISTED_FILES = 500;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const BINARY_SAMPLE_BYTES = 8192;
const BINARY_NULL_THRESHOLD = 0.1;

const IGNORE_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)\.agent-artifacts(\/|$)/,
  /\.log$/,
];

interface ToolContext {
  projectRoot: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => void;
}

interface PathInput {
  path: string;
}

interface WriteFileInput extends PathInput {
  content: string;
}

interface CommandInput {
  command: string;
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function isIgnored(relativePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function resolveProjectPath(root: string, requestedPath: string): string | null {
  if (isAbsolute(requestedPath)) return null;
  const abs = resolve(root, requestedPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

function truncateOutput(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= MAX_COMMAND_OUTPUT_BYTES) return value;
  return `${value.slice(0, MAX_COMMAND_OUTPUT_BYTES)}\n[output truncated]`;
}

async function walkProject(root: string, dir: string, paths: string[]): Promise<void> {
  if (paths.length >= MAX_LISTED_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = toPosix(relative(root, abs));
    if (!rel || isIgnored(rel)) continue;
    if (entry.isDirectory()) {
      await walkProject(root, abs, paths);
      continue;
    }
    if (entry.isFile()) paths.push(rel);
    if (paths.length >= MAX_LISTED_FILES) return;
  }
}

export async function listProjectFiles(root: string): Promise<{ paths: string[] }> {
  const paths: string[] = [];
  await walkProject(root, root, paths);
  return { paths: paths.sort() };
}

export async function readProjectFile(root: string, path: string): Promise<{
  path: string;
  content?: string;
  error?: "not_found" | "too_large" | "invalid_path" | "io_error" | "binary";
}> {
  const abs = resolveProjectPath(root, path);
  if (!abs) return { path, error: "invalid_path" };

  let fileStat;
  try {
    fileStat = await stat(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { path, error: code === "ENOENT" ? "not_found" : "io_error" };
  }
  if (!fileStat.isFile()) return { path, error: "not_found" };
  if (fileStat.size > MAX_FILE_BYTES) return { path, error: "too_large" };

  let buffer: Buffer;
  try {
    buffer = await readFile(abs);
  } catch {
    return { path, error: "io_error" };
  }
  if (buffer.length > MAX_FILE_BYTES) return { path, error: "too_large" };

  const sample = buffer.subarray(0, Math.min(BINARY_SAMPLE_BYTES, buffer.length));
  let nullCount = 0;
  for (const byte of sample) {
    if (byte === 0) nullCount++;
  }
  if (sample.length > 0 && nullCount / sample.length > BINARY_NULL_THRESHOLD) {
    return { path, error: "binary" };
  }

  return { path, content: buffer.toString("utf8") };
}

export async function writeProjectFile(root: string, path: string, content: string): Promise<{
  path: string;
  ok: boolean;
  reason?: "too_large" | "invalid_path" | "io_error";
}> {
  const abs = resolveProjectPath(root, path);
  if (!abs) return { path, ok: false, reason: "invalid_path" };
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { path, ok: false, reason: "too_large" };
  }

  try {
    await mkdir(dirname(abs), { recursive: true });
  } catch {
    return { path, ok: false, reason: "io_error" };
  }

  const tmp = join(dirname(abs), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, abs);
  } catch {
    await unlink(tmp).catch(() => {});
    return { path, ok: false, reason: "io_error" };
  }
  return { path, ok: true };
}

export async function runProjectCommand(root: string, command: string, signal?: AbortSignal): Promise<{
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return await new Promise((resolvePromise) => {
    const child = spawn("sh", ["-lc", command], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);

    const abort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString("utf8"));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolvePromise({
        command,
        exitCode: code,
        stdout,
        stderr,
        timedOut,
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolvePromise({
        command,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
      });
    });
  });
}

export function createVercelAiTools(ctx: ToolContext): ToolSet {
  return {
    list_files: tool({
      description: "List editable files in the project. Ignores node_modules, build output, git metadata, and logs.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        additionalProperties: false,
      }),
      execute: async () => {
        ctx.onEvent({ type: "agent.tool_use", turnId: ctx.turnId, tool: "list_files", input: {}, agentId: "coder" });
        return await listProjectFiles(ctx.projectRoot);
      },
    }),
    read_file: tool({
      description: "Read a UTF-8 text file from the project using a relative path.",
      inputSchema: jsonSchema<PathInput>({
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path inside the project." },
        },
        required: ["path"],
        additionalProperties: false,
      }),
      execute: async (input) => {
        ctx.onEvent({ type: "agent.tool_use", turnId: ctx.turnId, tool: "read_file", input, agentId: "coder" });
        return await readProjectFile(ctx.projectRoot, input.path);
      },
    }),
    write_file: tool({
      description: "Create or replace a UTF-8 text file in the project using a relative path.",
      inputSchema: jsonSchema<WriteFileInput>({
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path inside the project." },
          content: { type: "string", description: "Complete new file content." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      }),
      execute: async (input) => {
        ctx.onEvent({ type: "agent.status", turnId: ctx.turnId, phase: "writing_file", detail: input.path, agentId: "coder" });
        ctx.onEvent({ type: "agent.tool_use", turnId: ctx.turnId, tool: "write_file", input: { path: input.path }, agentId: "coder" });
        return await writeProjectFile(ctx.projectRoot, input.path, input.content);
      },
    }),
    run_command: tool({
      description: "Run a shell command in the project directory. Use for inspection, package scripts, formatting, and tests.",
      inputSchema: jsonSchema<CommandInput>({
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run from the project root." },
        },
        required: ["command"],
        additionalProperties: false,
      }),
      execute: async (input, options) => {
        ctx.onEvent({ type: "agent.tool_use", turnId: ctx.turnId, tool: "run_command", input, agentId: "coder" });
        return await runProjectCommand(ctx.projectRoot, input.command, options.abortSignal);
      },
    }),
  };
}
