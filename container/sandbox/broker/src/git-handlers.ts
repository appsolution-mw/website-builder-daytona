import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_BUFFER_BYTES = 1024 * 1024;
const GIT_USER_NAME = "Website Builder Sandbox";
const GIT_USER_EMAIL = "sandbox@website-builder.local";

export interface GitStatusRequest {
  projectRoot: string;
}

export interface GitStatusResponse {
  ok: true;
  hasChanges: boolean;
  entries: string[];
  porcelain: string[];
}

export interface CommitAndPushChangesRequest {
  projectRoot: string;
  remoteUrl: string;
  remoteAuth?: {
    username: string;
    password: string;
  };
  branch: string;
  commitMessage: string;
}

export type CommitAndPushChangesResponse =
  | { ok: true; branch: string; commitSha: string }
  | { ok: false; reason: "no_changes"; message: string };

export class GitCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitCommandError";
  }
}

export async function getGitStatus(input: GitStatusRequest): Promise<GitStatusResponse> {
  const output = await runGit(input.projectRoot, ["status", "--porcelain=v1"]);
  const porcelain = splitGitLines(output);
  return {
    ok: true,
    hasChanges: porcelain.length > 0,
    entries: porcelain,
    porcelain,
  };
}

export async function commitAndPushChanges(
  input: CommitAndPushChangesRequest,
): Promise<CommitAndPushChangesResponse> {
  validateCommitAndPushInput(input);
  await runGit(input.projectRoot, ["check-ref-format", "--branch", input.branch]);
  await runGit(input.projectRoot, ["config", "user.name", GIT_USER_NAME]);
  await runGit(input.projectRoot, ["config", "user.email", GIT_USER_EMAIL]);

  const status = await getGitStatus({ projectRoot: input.projectRoot });
  if (!status.hasChanges) {
    const currentBranch = (await runGit(input.projectRoot, ["branch", "--show-current"])).trim();
    const lastAuthorEmail = (await runGit(input.projectRoot, ["log", "-1", "--format=%ae"])).trim();
    if (currentBranch !== input.branch || lastAuthorEmail !== GIT_USER_EMAIL) {
      return { ok: false, reason: "no_changes", message: "No changes to commit" };
    }
  } else {
    await runGit(input.projectRoot, ["switch", "-C", input.branch]);
    await runGit(input.projectRoot, ["add", "-A"]);
    await runGit(input.projectRoot, ["commit", "-m", input.commitMessage]);
  }

  const commitSha = (await runGit(input.projectRoot, ["rev-parse", "HEAD"])).trim();
  await runGitWithAuth(
    input.projectRoot,
    ["push", input.remoteUrl, `HEAD:${input.branch}`],
    input.remoteAuth,
  );

  return {
    ok: true,
    branch: input.branch,
    commitSha,
  };
}

export function sanitizeGitOutput(output: string): string {
  return output
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s'"]+)@/gi, "$1[redacted]@")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[redacted]");
}

async function runGit(projectRoot: string, args: string[]): Promise<string> {
  return runGitWithEnv(projectRoot, args);
}

async function runGitWithAuth(
  projectRoot: string,
  args: string[],
  remoteAuth: CommitAndPushChangesRequest["remoteAuth"],
): Promise<string> {
  if (!remoteAuth) {
    return runGitWithEnv(projectRoot, args);
  }

  const askpassDir = await mkdtemp(join(tmpdir(), "wbd-git-askpass-"));
  const askpassPath = join(askpassDir, "askpass.sh");
  try {
    await writeFile(
      askpassPath,
      [
        "#!/bin/sh",
        "case \"$1\" in",
        "  *Username*) printf '%s\\n' \"$GIT_AUTH_USERNAME\" ;;",
        "  *Password*) printf '%s\\n' \"$GIT_AUTH_PASSWORD\" ;;",
        "  *) printf '\\n' ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    return await runGitWithEnv(projectRoot, args, {
      GIT_ASKPASS: askpassPath,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTH_USERNAME: remoteAuth.username,
      GIT_AUTH_PASSWORD: remoteAuth.password,
    });
  } finally {
    await rm(askpassDir, { recursive: true, force: true });
  }
}

async function runGitWithEnv(
  projectRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectRoot,
      maxBuffer: GIT_COMMAND_BUFFER_BYTES,
      env: env ? { ...process.env, ...env } : process.env,
    });
    return stdout;
  } catch (error) {
    const err = error as ExecFileException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const output = [
      err.message,
      bufferToString(err.stdout),
      bufferToString(err.stderr),
    ].filter(Boolean).join("\n");
    throw new GitCommandError(sanitizeGitOutput(output));
  }
}

function validateCommitAndPushInput(input: CommitAndPushChangesRequest): void {
  if (!input.projectRoot.trim()) {
    throw new GitCommandError("projectRoot is required");
  }
  if (!input.remoteUrl.trim()) {
    throw new GitCommandError("remoteUrl is required");
  }
  if (!input.branch.trim()) {
    throw new GitCommandError("branch is required");
  }
  if (!input.commitMessage.trim()) {
    throw new GitCommandError("commitMessage is required");
  }
}

function splitGitLines(output: string): string[] {
  const withoutTrailingNewline = output.replace(/\r?\n$/, "");
  if (!withoutTrailingNewline) return [];
  return withoutTrailingNewline.split(/\r?\n/);
}

function bufferToString(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

const COMMIT_BODY_MAX_BYTES = 8 * 1024;
const AGENT_AUTHOR = "launchnode-agent <agent@launchnode.de>";

const COMMIT_TITLE_MAX = 72;

export function sanitizeCommitTitle(input: string | null | undefined, fallback = "agent turn"): string {
  if (!input) return fallback;
  const firstLine = input.split(/\r?\n/)[0] ?? "";
  const stripped = firstLine
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return fallback;
  if (stripped.length <= COMMIT_TITLE_MAX) return stripped;
  return `${stripped.slice(0, COMMIT_TITLE_MAX - 1)}…`;
}

export interface CommitAgentTurnRequest {
  projectRoot: string;
  runId: string;
  userPromptFirstLine: string | null;
  userPromptFull: string | null;
  runtime: string;
  modelId: string | null;
}

export type CommitAgentTurnResponse =
  | {
      ok: true;
      sha: string;
      shortSha: string;
      title: string;
      bodyMessage: string;
      filesChanged: number;
      insertions: number;
      deletions: number;
      committedAt: string;
    }
  | { ok: false; reason: "no_changes" }
  | { ok: false; reason: "commit_failed"; detail: string };

export async function commitAgentTurn(
  input: CommitAgentTurnRequest,
): Promise<CommitAgentTurnResponse> {
  let status: GitStatusResponse;
  try {
    status = await getGitStatus({ projectRoot: input.projectRoot });
  } catch (error) {
    const detail = sanitizeGitOutput(extractErrorMessage(error));
    return { ok: false, reason: "commit_failed", detail };
  }
  if (!status.hasChanges) return { ok: false, reason: "no_changes" };

  const fallbackTitle = `agent turn ${input.runId.slice(0, 10)}`;
  const title = sanitizeCommitTitle(input.userPromptFirstLine, fallbackTitle);
  const bodyMessage = buildCommitBody(input);

  try {
    await runGit(input.projectRoot, ["add", "-A"]);
    const commitArgs = [
      "-c",
      "commit.gpgsign=false",
      "commit",
      `--author=${AGENT_AUTHOR}`,
      "-m",
      title,
      "-m",
      bodyMessage,
    ];
    await runGit(input.projectRoot, commitArgs);
  } catch (error) {
    const detail = sanitizeGitOutput(extractErrorMessage(error));
    return { ok: false, reason: "commit_failed", detail };
  }

  let sha: string;
  let stat: { filesChanged: number; insertions: number; deletions: number };
  try {
    sha = (await runGit(input.projectRoot, ["rev-parse", "HEAD"])).trim();
    stat = await readShortstat(input.projectRoot, sha);
  } catch (error) {
    const detail = sanitizeGitOutput(extractErrorMessage(error));
    return { ok: false, reason: "commit_failed", detail };
  }

  return {
    ok: true,
    sha,
    shortSha: sha.slice(0, 7),
    title,
    bodyMessage,
    filesChanged: stat.filesChanged,
    insertions: stat.insertions,
    deletions: stat.deletions,
    committedAt: new Date().toISOString(),
  };
}

function buildCommitBody(input: CommitAgentTurnRequest): string {
  const fullPrompt = (input.userPromptFull ?? "").trim();
  const truncatedPrompt = byteTruncate(fullPrompt, COMMIT_BODY_MAX_BYTES - 256);
  const trailers = [
    `Runtime: ${input.runtime}`,
    input.modelId ? `Model: ${input.modelId}` : null,
    `Run: ${input.runId}`,
  ]
    .filter(Boolean)
    .join("\n");
  const sections = [truncatedPrompt, trailers].filter((s) => s.length > 0);
  return sections.join("\n\n");
}

function byteTruncate(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
  const buf = Buffer.from(input, "utf8");
  // Walk backwards from maxBytes to the start of the last complete UTF-8 code point.
  // UTF-8 continuation bytes have the bit pattern 10xxxxxx (0x80–0xBF).
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return `${buf.subarray(0, end).toString("utf8")}…`;
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.length > 0) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function getCommitFiles(input: {
  projectRoot: string;
  sha: string;
}): Promise<{ files: { path: string; insertions: number; deletions: number }[] }> {
  if (!/^[a-f0-9]{40}$/.test(input.sha)) throw new GitCommandError("invalid sha");
  const out = await runGit(input.projectRoot, ["show", "--numstat", "--format=", input.sha]);
  const files = out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ins, del, ...rest] = line.split("\t");
      return {
        insertions: ins === "-" ? 0 : parseInt(ins ?? "", 10) || 0,
        deletions: del === "-" ? 0 : parseInt(del ?? "", 10) || 0,
        path: rest.join("\t"),
      };
    });
  return { files };
}

export async function getCommitDiff(input: {
  projectRoot: string;
  sha: string;
  path: string;
}): Promise<{ diff: string }> {
  if (!/^[a-f0-9]{40}$/.test(input.sha)) throw new GitCommandError("invalid sha");
  if (!isSafeRelativePath(input.path)) throw new GitCommandError("invalid path");
  const out = await runGit(input.projectRoot, [
    "show",
    "--format=",
    input.sha,
    "--",
    input.path,
  ]);
  return { diff: sanitizeGitOutput(out) };
}

function isSafeRelativePath(p: string): boolean {
  return p.length > 0 && !p.startsWith("/") && !p.includes("..") && !p.includes("\0");
}

async function readShortstat(
  projectRoot: string,
  sha: string,
): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
  let raw: string;
  try {
    raw = await runGit(projectRoot, ["diff", "--shortstat", `${sha}~1`, sha]);
  } catch {
    raw = await runGit(projectRoot, ["diff-tree", "--shortstat", "--root", sha]);
  }
  const text = raw.trim();
  const filesChanged = matchInt(text, /(\d+)\s+files?\s+changed/);
  const insertions = matchInt(text, /(\d+)\s+insertions?\(\+\)/);
  const deletions = matchInt(text, /(\d+)\s+deletions?\(-\)/);
  return { filesChanged, insertions, deletions };
}

function matchInt(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? parseInt(m[1]!, 10) : 0;
}
