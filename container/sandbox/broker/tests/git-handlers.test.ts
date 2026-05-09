import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  commitAgentTurn,
  commitAndPushChanges,
  getCommitDiff,
  getCommitFiles,
  getGitStatus,
  sanitizeCommitTitle,
  sanitizeGitOutput,
} from "../src/git-handlers";

const execFileAsync = promisify(execFile);

describe("git handlers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("reports porcelain status lines for changed files", async () => {
    const root = await createRepository();
    await writeFile(join(root, "README.md"), "changed\n");
    await writeFile(join(root, "new.txt"), "new\n");

    const result = await getGitStatus({ projectRoot: root });

    expect(result).toEqual({
      ok: true,
      hasChanges: true,
      entries: [" M README.md", "?? new.txt"],
      porcelain: [" M README.md", "?? new.txt"],
    });
  });

  it("returns no_changes without committing when the repository is clean", async () => {
    const root = await createRepository();
    const before = await git(root, ["rev-parse", "HEAD"]);

    const result = await commitAndPushChanges({
      projectRoot: root,
      remoteUrl: await createBareRemote(),
      branch: "saveback/clean",
      commitMessage: "Save clean state",
    });
    const after = await git(root, ["rev-parse", "HEAD"]);

    expect(result).toEqual({
      ok: false,
      reason: "no_changes",
      message: "No changes to commit",
    });
    expect(after).toBe(before);
  });

  it("commits changed files and pushes them to the requested remote branch", async () => {
    const root = await createRepository();
    const remote = await createBareRemote();
    await writeFile(join(root, "README.md"), "changed\n");

    const result = await commitAndPushChanges({
      projectRoot: root,
      remoteUrl: remote,
      branch: "saveback/test-branch",
      commitMessage: "Save sandbox changes",
    });

    expect(result).toMatchObject({
      ok: true,
      branch: "saveback/test-branch",
    });
    expect(result.ok && result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const remoteSha = await execGit(["--git-dir", remote, "rev-parse", "saveback/test-branch"]);
    expect(result.ok && result.commitSha).toBe(remoteSha);
  });

  it("retries pushing an existing saveback commit when the workspace is clean", async () => {
    const root = await createRepository();
    const unreachableRemote = await createTempDir("wbd-git-not-bare-");
    await writeFile(join(root, "README.md"), "changed once\n");
    await expect(commitAndPushChanges({
      projectRoot: root,
      remoteUrl: unreachableRemote,
      branch: "saveback/retry",
      commitMessage: "Save sandbox changes",
    })).rejects.toThrow();
    const retryRemote = await createBareRemote();

    const result = await commitAndPushChanges({
      projectRoot: root,
      remoteUrl: retryRemote,
      branch: "saveback/retry",
      commitMessage: "Save sandbox changes",
    });

    expect(result).toMatchObject({ ok: true, branch: "saveback/retry" });
    const remoteSha = await execGit(["--git-dir", retryRemote, "rev-parse", "saveback/retry"]);
    expect(result.ok && result.commitSha).toBe(remoteSha);
  });

  it("pushes authenticated remotes without putting credentials in the remote argv", async () => {
    const root = await createRepository();
    const remote = await createBareRemote();
    await writeFile(join(root, "README.md"), "changed\n");

    await commitAndPushChanges({
      projectRoot: root,
      remoteUrl: remote,
      remoteAuth: { username: "x-access-token", password: "secret-token" },
      branch: "saveback/auth",
      commitMessage: "Save sandbox changes",
    });

    const remotes = await git(root, ["remote", "-v"]);
    expect(remotes).not.toContain("secret-token");
  });

  it("redacts credentials from git output", () => {
    const sanitized = sanitizeGitOutput(
      "fatal: unable to access 'https://user:ghp_secret123@github.com/acme/repo.git/'",
    );

    expect(sanitized).not.toContain("user");
    expect(sanitized).not.toContain("ghp_secret123");
    expect(sanitized).toContain("https://[redacted]@github.com/acme/repo.git/");
  });

  async function createRepository(): Promise<string> {
    const root = await createTempDir("wbd-git-repo-");
    await git(root, ["init"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(join(root, "README.md"), "initial\n");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "Initial commit"]);
    return root;
  }

  async function createBareRemote(): Promise<string> {
    const remote = await createTempDir("wbd-git-remote-");
    await execGit(["init", "--bare", remote]);
    return remote;
  }

  async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  return execGit(["-C", cwd, ...args]);
}

async function execGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args);
  return stdout.trim();
}

describe("sanitizeCommitTitle", () => {
  it("returns first non-empty line, trimmed", () => {
    expect(sanitizeCommitTitle("  hello\nworld  ")).toBe("hello");
  });

  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeCommitTitle("a  b\tc")).toBe("a b c");
  });

  it("truncates titles longer than 72 chars with an ellipsis", () => {
    const long = "x".repeat(80);
    const result = sanitizeCommitTitle(long);
    expect(result.length).toBe(72);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns the fallback when input is null, empty, or whitespace-only", () => {
    expect(sanitizeCommitTitle(null, "agent turn abc1234")).toBe("agent turn abc1234");
    expect(sanitizeCommitTitle("", "agent turn abc1234")).toBe("agent turn abc1234");
    expect(sanitizeCommitTitle("   \n\t  ", "agent turn abc1234")).toBe("agent turn abc1234");
  });

  it("handles multi-byte unicode without overshooting the byte cap", () => {
    const result = sanitizeCommitTitle("café".repeat(20));
    expect(result.length).toBeLessThanOrEqual(72);
  });
});

describe("commitAgentTurn", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "wbd-commit-agent-"));
    tempDirs.push(root);
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(join(root, "README.md"), "initial\n");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "Initial commit"]);
    return root;
  }

  it("returns no_changes for a clean working tree", async () => {
    const root = await createRepository();
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_1",
      userPromptFirstLine: "Add a hero section",
      userPromptFull: "Add a hero section",
      runtime: "claude-code",
      modelId: "sonnet-4-6",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_changes");
  });

  it("commits a dirty working tree with sanitised title and bot author", async () => {
    const root = await createRepository();
    await writeFile(join(root, "page.tsx"), "export default function Page() {}\n");
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_2",
      userPromptFirstLine: "Add a hero section\nwith a CTA",
      userPromptFull: "Add a hero section\nwith a CTA",
      runtime: "claude-code",
      modelId: "sonnet-4-6",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(result.shortSha).toBe(result.sha.slice(0, 7));
    expect(result.title).toBe("Add a hero section");
    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBeGreaterThanOrEqual(1);

    const lastAuthor = (await git(root, ["log", "-1", "--format=%an <%ae>"])).trim();
    expect(lastAuthor).toBe("launchnode-agent <agent@launchnode.de>");

    const body = (await git(root, ["log", "-1", "--format=%B"])).trim();
    expect(body).toContain("Runtime: claude-code");
    expect(body).toContain("Run: run_2");
  });

  it("uses the fallback title when the user prompt is null", async () => {
    const root = await createRepository();
    await writeFile(join(root, "x.txt"), "x\n");
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_abc1234",
      userPromptFirstLine: null,
      userPromptFull: null,
      runtime: "claude-code",
      modelId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe("agent turn run_abc123");
  });

  it("returns commit_failed with sanitised detail when commit throws", async () => {
    const root = await createRepository();
    await writeFile(join(root, "x.txt"), "x\n");
    await writeFile(join(root, ".git/index"), "corrupt-index");
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_3",
      userPromptFirstLine: "broken",
      userPromptFull: "broken",
      runtime: "claude-code",
      modelId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "commit_failed") {
      throw new Error(`expected commit_failed, got ${JSON.stringify(result)}`);
    }
    expect(typeof result.detail).toBe("string");
    expect(result.detail).not.toMatch(/gh[pousr]_[A-Za-z0-9_]+/);
  });

  it("does not produce U+FFFD replacement characters when truncating multi-byte prompts", async () => {
    const root = await createRepository();
    await writeFile(join(root, "x.txt"), "x\n");
    // 9 KB of German umlauts — each "äöü" is 6 UTF-8 bytes for 3 chars; total well over 8 KB.
    const longPrompt = "Füge bitte ein Hörmodul für die Übersetzung ein. ".repeat(200);
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_utf8",
      userPromptFirstLine: longPrompt.split("\n")[0]!,
      userPromptFull: longPrompt,
      runtime: "claude-code",
      modelId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodyMessage).not.toContain("�");
  });

  it("computes shortstat for the very first commit using --root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wbd-commit-empty-"));
    tempDirs.push(root);
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "user.email", "init@test.local"]);
    await git(root, ["config", "user.name", "Init"]);
    await writeFile(join(root, "first.txt"), "first\n");
    const result = await commitAgentTurn({
      projectRoot: root,
      runId: "run_first",
      userPromptFirstLine: "first commit",
      userPromptFull: "first commit",
      runtime: "claude-code",
      modelId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesChanged).toBe(1);
  });
});

describe("getCommitFiles", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "wbd-git-commit-files-"));
    tempDirs.push(root);
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(join(root, "seed.txt"), "seed\n");
    await git(root, ["add", "seed.txt"]);
    await git(root, ["commit", "-m", "seed"]);
    return root;
  }

  it("returns numstat per file for a known sha", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.txt"), "1\n");
    await writeFile(join(root, "b.txt"), "1\n2\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "two files"]);
    const sha = (await git(root, ["rev-parse", "HEAD"])).trim();
    const { files } = await getCommitFiles({ projectRoot: root, sha });
    expect(files.map((f) => f.path).sort()).toEqual(["a.txt", "b.txt"]);
    const a = files.find((f) => f.path === "a.txt")!;
    expect(a.insertions).toBe(1);
    expect(a.deletions).toBe(0);
  });

  it("rejects an invalid sha", async () => {
    const root = await createRepository();
    await expect(getCommitFiles({ projectRoot: root, sha: "not-a-sha" })).rejects.toThrow();
  });
});

describe("getCommitDiff", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "wbd-git-commit-diff-"));
    tempDirs.push(root);
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(join(root, "seed.txt"), "seed\n");
    await git(root, ["add", "seed.txt"]);
    await git(root, ["commit", "-m", "seed"]);
    return root;
  }

  it("returns the unified diff for a single path", async () => {
    const root = await createRepository();
    await writeFile(join(root, "a.txt"), "hello\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "init file"]);
    const sha = (await git(root, ["rev-parse", "HEAD"])).trim();
    const { diff } = await getCommitDiff({ projectRoot: root, sha, path: "a.txt" });
    expect(diff).toContain("+hello");
  });

  it("rejects path traversal", async () => {
    const root = await createRepository();
    await expect(
      getCommitDiff({ projectRoot: root, sha: "0".repeat(40), path: "../etc/passwd" }),
    ).rejects.toThrow();
  });
});
