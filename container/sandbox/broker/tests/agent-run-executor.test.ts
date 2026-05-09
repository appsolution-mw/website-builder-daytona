import type { AgentProvider, AgentTurnOptions } from "../src/agent-provider";
import type { SpawnFn } from "../src/spawn-types";
import type { BrokerToHost, PromptImageAttachment } from "@wbd/protocol";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

const runTurnMock = vi.hoisted(() => vi.fn());
const createAgentProviderMock = vi.hoisted(() => vi.fn());

vi.mock("../src/agent-provider-factory", () => ({
  createAgentProvider: createAgentProviderMock,
}));

import { executeAgentRun } from "../src/agent-run-executor";

describe("executeAgentRun", () => {
  it("calls the selected provider with durable run metadata", async () => {
    createAgentProviderMock.mockReturnValue({
      runtime: "openhands",
      runTurn: runTurnMock,
    } satisfies AgentProvider);

    await executeAgentRun({
      projectId: "project-1",
      sessionId: "session-1",
      providerSessionId: "provider-session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      prompt: "Build it",
      runtime: "openhands",
      resumeSession: true,
      modelId: "openrouter:test/model",
      projectRoot: "/workspace/project",
      signal: new AbortController().signal,
      persistEvent: async () => undefined,
      broadcastEvent: () => undefined,
    });

    expect(createAgentProviderMock).toHaveBeenCalledWith({ runtime: "openhands" });
    expect(runTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionId: "provider-session-1",
      resumeSession: true,
      prompt: "Build it",
      turnId: "run-1",
      projectRoot: "/workspace/project",
      modelId: "openrouter:test/model",
      run: {
        runId: "run-1",
        attemptId: "attempt-1",
        conversationId: "provider-session-1",
        persistenceDir: "/workspace/project/.agent-artifacts/openhands/conversations",
      },
    }));
  });

  it("persists provider events before broadcasting them", async () => {
    const event: BrokerToHost = { type: "agent.chunk", turnId: "run-1", delta: "hello" };
    const order: string[] = [];
    createAgentProviderMock.mockReturnValue({
      runtime: "openai-codex",
      runTurn: async (opts) => {
        await opts.onEvent(event);
      },
    } satisfies AgentProvider);

    await executeAgentRun({
      projectId: "project-1",
      sessionId: "session-1",
      providerSessionId: "provider-session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      prompt: "Build it",
      runtime: "openai-codex",
      resumeSession: false,
      projectRoot: "/workspace/project",
      signal: new AbortController().signal,
      persistEvent: async () => {
        order.push("persist");
      },
      broadcastEvent: () => {
        order.push("broadcast");
      },
    });

    // persist must always come before its corresponding broadcast. The post-run
    // commit hook may add an extra git.commit.skipped pair (the bogus
    // /workspace/project path makes getGitStatus throw → commit_failed), but
    // the persist-before-broadcast invariant must hold for every event.
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]).toBe("persist");
      expect(order[i + 1]).toBe("broadcast");
    }
    expect(order.length).toBeGreaterThanOrEqual(2);
  });

  describe("with image attachments", () => {
    let projectRoot: string;
    const attachment: PromptImageAttachment = {
      name: "pixel.png",
      // 1x1 transparent PNG
      dataBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      mimeType: "image/png",
    };

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "agent-run-executor-"));
      runTurnMock.mockReset();
      createAgentProviderMock.mockReset();
    });

    afterEach(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("forwards openai-codex attachments as attachmentPaths and keeps the prompt clean", async () => {
      createAgentProviderMock.mockReturnValue({
        runtime: "openai-codex",
        runTurn: runTurnMock,
      } satisfies AgentProvider);

      await executeAgentRun({
        projectId: "project-1",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        runId: "run-codex-1",
        attemptId: "attempt-1",
        prompt: "Look at this",
        runtime: "openai-codex",
        resumeSession: false,
        attachments: [attachment],
        projectRoot,
        signal: new AbortController().signal,
        persistEvent: async () => undefined,
        broadcastEvent: () => undefined,
      });

      expect(runTurnMock).toHaveBeenCalledTimes(1);
      const call = runTurnMock.mock.calls[0]?.[0] as {
        prompt: string;
        attachmentPaths?: string[];
        attachments?: unknown;
      };

      // Prompt MUST stay clean — no "## Attached images" suffix, no @<path> bullet.
      expect(call.prompt).toBe("Look at this");
      expect(call.prompt).not.toMatch(/Attached images/i);
      expect(call.prompt).not.toMatch(/^\s*-\s*@/m);

      // Codex receives image paths via the dedicated multimodal field.
      expect(call.attachmentPaths).toBeDefined();
      expect(call.attachmentPaths).toHaveLength(1);
      const imagePath = call.attachmentPaths![0]!;
      expect(imagePath.startsWith(projectRoot)).toBe(true);
      expect(imagePath).toContain("/.agent-artifacts/chat-attachments/run-codex-1/");

      // The file actually exists on disk — verifies prepareDiskAttachments ran.
      const written = await readFile(imagePath);
      expect(written.length).toBeGreaterThan(0);

      // Codex must NOT receive the protocol `attachments` array — only paths.
      expect(call.attachments).toBeUndefined();
    });

    it("appends the @<path> suffix to the claude-code prompt and does not pass attachmentPaths", async () => {
      createAgentProviderMock.mockReturnValue({
        runtime: "claude-code",
        runTurn: runTurnMock,
      } satisfies AgentProvider);

      await executeAgentRun({
        projectId: "project-1",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        runId: "run-claude-1",
        attemptId: "attempt-1",
        prompt: "Look at this",
        runtime: "claude-code",
        resumeSession: false,
        attachments: [attachment],
        projectRoot,
        signal: new AbortController().signal,
        persistEvent: async () => undefined,
        broadcastEvent: () => undefined,
      });

      const call = runTurnMock.mock.calls[0]?.[0] as {
        prompt: string;
        attachmentPaths?: string[];
        attachments?: unknown;
      };

      expect(call.prompt).toMatch(/^Look at this/);
      expect(call.prompt).toMatch(/## Attached images/);
      expect(call.prompt).toMatch(
        new RegExp(`- @${projectRoot}/.agent-artifacts/chat-attachments/run-claude-1/0\\.png`),
      );

      // Claude Code path must NOT use the codex-only attachmentPaths channel.
      expect(call.attachmentPaths).toBeUndefined();
    });
  });
});

describe("executeAgentRun — commit hook", () => {
  const tempDirs: string[] = [];

  async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
    return stdout.trim();
  }

  async function createRepository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "wbd-exec-commit-"));
    tempDirs.push(root);
    await git(root, ["init", "-q", "-b", "main"]);
    await git(root, ["config", "user.name", "Test User"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await writeFile(join(root, "README.md"), "initial\n");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-q", "-m", "Initial commit"]);
    return root;
  }

  // SpawnFn-shaped sentinel that also carries the desired agent.done exitCode.
  // The createAgentProviderMock below reads `(spawn as { __exitCode?: number }).__exitCode`
  // off the spawn passed via `__testSpawn` and emits a single agent.done event with it.
  function makeFakeSuccessSpawn(opts: { exitCode: number }): SpawnFn {
    const fn: SpawnFn = () => {
      // Never actually invoked — the mocked provider intercepts the call.
      throw new Error("makeFakeSuccessSpawn child should never spawn in unit tests");
    };
    (fn as unknown as { __exitCode: number }).__exitCode = opts.exitCode;
    return fn;
  }

  beforeEach(() => {
    runTurnMock.mockReset();
    createAgentProviderMock.mockReset();
    createAgentProviderMock.mockImplementation((opts: { __testSpawn?: SpawnFn; runtime: string }) => {
      const exitCode = (opts.__testSpawn as unknown as { __exitCode?: number } | undefined)
        ?.__exitCode ?? 0;
      const provider: AgentProvider = {
        runtime: opts.runtime as AgentProvider["runtime"],
        async runTurn(turn: AgentTurnOptions) {
          await turn.onEvent({
            type: "agent.done",
            turnId: turn.turnId,
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            exitCode,
          });
        },
      };
      return provider;
    });
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("emits git.commit after a successful agent.done when working tree is dirty", async () => {
    const projectRoot = await createRepository();
    await writeFile(join(projectRoot, "page.tsx"), "x\n");
    const events: BrokerToHost[] = [];

    await executeAgentRun({
      projectId: "p1",
      sessionId: "s1",
      providerSessionId: "ps1",
      runId: "run_x",
      attemptId: "a1",
      prompt: "Add a hero section",
      runtime: "claude-code",
      resumeSession: false,
      projectRoot,
      signal: new AbortController().signal,
      persistEvent: async (e) => {
        events.push(e);
      },
      broadcastEvent: () => {},
      __testSpawn: makeFakeSuccessSpawn({ exitCode: 0 }),
    });

    const commitEvents = events.filter((e) => e.type === "git.commit");
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0]).toMatchObject({
      type: "git.commit",
      turnId: "run_x",
      runtime: "claude-code",
      authorKind: "AGENT",
      title: "Add a hero section",
    });
  });

  it("emits git.commit.skipped with no_changes for a clean working tree", async () => {
    const projectRoot = await createRepository();
    const events: BrokerToHost[] = [];

    await executeAgentRun({
      projectId: "p1",
      sessionId: "s1",
      providerSessionId: "ps1",
      runId: "run_y",
      attemptId: "a1",
      prompt: "noop",
      runtime: "claude-code",
      resumeSession: false,
      projectRoot,
      signal: new AbortController().signal,
      persistEvent: async (e) => {
        events.push(e);
      },
      broadcastEvent: () => {},
      __testSpawn: makeFakeSuccessSpawn({ exitCode: 0 }),
    });

    const skipped = events.filter((e) => e.type === "git.commit.skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ type: "git.commit.skipped", reason: "no_changes" });
  });

  it("emits git.commit when agent.done reports non-zero exitCode but the working tree is dirty", async () => {
    // Claude Agent SDK's `error_during_execution` subtype frequently fires
    // after real file writes succeeded. The commit gate must not lose that
    // work just because the SDK reported a non-zero exit.
    const projectRoot = await createRepository();
    await writeFile(join(projectRoot, "x.txt"), "x\n");
    const events: BrokerToHost[] = [];

    await executeAgentRun({
      projectId: "p1",
      sessionId: "s1",
      providerSessionId: "ps1",
      runId: "run_z",
      attemptId: "a1",
      prompt: "Add x file",
      runtime: "claude-code",
      resumeSession: false,
      projectRoot,
      signal: new AbortController().signal,
      persistEvent: async (e) => {
        events.push(e);
      },
      broadcastEvent: () => {},
      __testSpawn: makeFakeSuccessSpawn({ exitCode: 1 }),
    });

    const commitEvents = events.filter((e) => e.type === "git.commit");
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0]).toMatchObject({
      type: "git.commit",
      turnId: "run_z",
      runtime: "claude-code",
      authorKind: "AGENT",
    });
  });

  it("emits git.commit.skipped when agent.done reports non-zero exitCode and the working tree is clean", async () => {
    const projectRoot = await createRepository();
    const events: BrokerToHost[] = [];

    await executeAgentRun({
      projectId: "p1",
      sessionId: "s1",
      providerSessionId: "ps1",
      runId: "run_z2",
      attemptId: "a1",
      prompt: "noop",
      runtime: "claude-code",
      resumeSession: false,
      projectRoot,
      signal: new AbortController().signal,
      persistEvent: async (e) => {
        events.push(e);
      },
      broadcastEvent: () => {},
      __testSpawn: makeFakeSuccessSpawn({ exitCode: 1 }),
    });

    const skipped = events.filter((e) => e.type === "git.commit.skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ type: "git.commit.skipped", reason: "no_changes" });
  });

  it("does not emit a commit event when the run is aborted", async () => {
    const projectRoot = await createRepository();
    await writeFile(join(projectRoot, "x.txt"), "x\n");
    const events: BrokerToHost[] = [];
    const controller = new AbortController();
    controller.abort();

    await executeAgentRun({
      projectId: "p1",
      sessionId: "s1",
      providerSessionId: "ps1",
      runId: "run_a",
      attemptId: "a1",
      prompt: "aborted",
      runtime: "claude-code",
      resumeSession: false,
      projectRoot,
      signal: controller.signal,
      persistEvent: async (e) => {
        events.push(e);
      },
      broadcastEvent: () => {},
      __testSpawn: makeFakeSuccessSpawn({ exitCode: 0 }),
    });

    expect(
      events.some((e) => e.type === "git.commit" || e.type === "git.commit.skipped"),
    ).toBe(false);
  });
});
