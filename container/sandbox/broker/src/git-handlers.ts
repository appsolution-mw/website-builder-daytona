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
