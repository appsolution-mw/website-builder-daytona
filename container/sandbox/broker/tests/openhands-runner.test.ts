import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import type { BrokerToHost } from "@wbd/protocol";
import {
  normalizeOpenHandsModelId,
  runOpenHandsReviewPass,
  runOpenHandsTurn,
  type OpenHandsSpawnFn,
} from "../src/openhands-runner";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function makeFakeChild(stdoutLines: string[], exitCode = 0, stderrChunks: string[] = []) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    stdin: Writable;
    kill: (sig?: NodeJS.Signals | number) => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn(() => true);

  setImmediate(() => {
    for (const line of stdoutLines) (child.stdout as PassThrough).write(`${line}\n`);
    for (const chunk of stderrChunks) (child.stderr as PassThrough).write(chunk);
    (child.stdout as PassThrough).end();
    (child.stderr as PassThrough).end();
    setImmediate(() => child.emit("close", exitCode));
  });

  return child;
}

describe("OpenHands runner", () => {
  it("normalizes OpenRouter model ids for OpenHands", () => {
    expect(normalizeOpenHandsModelId("openrouter:qwen/qwen3-coder:free")).toBe(
      "openrouter/qwen/qwen3-coder:free",
    );
    expect(normalizeOpenHandsModelId("openrouter:moonshotai/kimi-k2.6")).toBe(
      "openrouter/moonshotai/kimi-k2.6",
    );
    expect(normalizeOpenHandsModelId("  openrouter:qwen/qwen3-coder:free  ")).toBe(
      "openrouter/qwen/qwen3-coder:free",
    );
    expect(normalizeOpenHandsModelId(undefined)).toBe("");
  });

  it("creates default AGENTS.md before starting OpenHands when missing", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const projectRoot = await mkdtemp(join(tmpdir(), "openhands-project-"));
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "done", durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    try {
      await runOpenHandsTurn(
        {
          projectId: "project-1",
          sessionId: "session-1",
          resumeSession: false,
          prompt: "hello",
          turnId: "turn-1",
          modelId: "openrouter:qwen/qwen3-coder:free",
          projectRoot,
          onEvent: () => {},
        },
        { spawn },
      );

      const content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
      expect(content).toContain("Next.js 16 App Router");
      expect(content).toContain("Do not create or rely on a root `index.html`");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("emits agent.error when an OpenRouter model is selected without a bridge API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY;
    const events: BrokerToHost[] = [];
    const spawn = vi.fn(() => makeFakeChild([])) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "openrouter:qwen/qwen3-coder:free",
        onEvent: (event) => events.push(event),
      },
      { spawn },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.error",
        turnId: "turn-1",
        message: "openhands runtime requires OPENROUTER_API_KEY or LLM_API_KEY for OpenRouter models.",
      },
    ]);
  });

  it("emits agent.error when a non-OpenRouter model is selected without a bridge API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY;
    const events: BrokerToHost[] = [];
    const spawn = vi.fn(() => makeFakeChild([])) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "anthropic/claude-sonnet-4-6",
        onEvent: (event) => events.push(event),
      },
      { spawn },
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual<BrokerToHost[]>([
      {
        type: "agent.error",
        turnId: "turn-1",
        message: "openhands runtime requires LLM_API_KEY or OPENROUTER_API_KEY.",
      },
    ]);
  });

  it("allows either bridge API key for OpenRouter and non-OpenRouter models", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.LLM_API_KEY = "llm-test";
    const openRouterSpawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "done", durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "openrouter/qwen/qwen3-coder:free",
        onEvent: () => {},
      },
      { spawn: openRouterSpawn },
    );

    expect(openRouterSpawn).toHaveBeenCalledOnce();

    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.LLM_API_KEY;
    const nonOpenRouterSpawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "done", durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-2",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-2",
        modelId: "anthropic/claude-sonnet-4-6",
        onEvent: () => {},
      },
      { spawn: nonOpenRouterSpawn },
    );

    expect(nonOpenRouterSpawn).toHaveBeenCalledOnce();
  });

  it("spawns the planned bridge CLI with expected env and streams JSONL records", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.PRESERVED_ENV = "kept";
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.OPENHANDS_BASE_URL;
    delete process.env.OPENHANDS_MAX_ITERATIONS;
    delete process.env.OPENHANDS_ENABLE_PUBLIC_SKILLS;
    const events: BrokerToHost[] = [];
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "chunk", delta: "Hi" }),
        "{broken",
        JSON.stringify({ type: "tool", tool: "Bash", input: { command: "pwd" } }),
        JSON.stringify({ type: "done", durationMs: 7, tokensIn: 3, tokensOut: 4, costUsd: 0.002 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: true,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "openrouter:qwen/qwen3-coder:free",
        onEvent: (event) => events.push(event),
      },
      { spawn },
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.chunk",
      "agent.tool_use",
      "agent.done",
    ]);
    const mockFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const [, argv, options] = mockFn.mock.calls[0] as [
      string,
      string[],
      { cwd?: string; env?: NodeJS.ProcessEnv },
    ];
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      [
        "/opt/builder/container/sandbox/broker/python/openhands_bridge.py",
        "--session",
        "session-1",
        "--workspace",
        "/workspace/project",
        "--model",
        "openrouter/qwen/qwen3-coder:free",
        "--prompt",
        "hello",
      ],
      expect.objectContaining({ cwd: "/workspace/project" }),
    );
    expect(argv).not.toContain("--session-id");
    expect(argv).not.toContain("--resume");
    expect(options.env).toMatchObject({
      PRESERVED_ENV: "kept",
      LLM_MODEL: "openrouter/qwen/qwen3-coder:free",
      LLM_API_KEY: "sk-or-test",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      OPENHANDS_MAX_ITERATIONS: "30",
      OPENHANDS_ENABLE_PUBLIC_SKILLS: "0",
    });
  });

  it("writes image attachment manifest and passes it to the OpenHands bridge", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const projectRoot = await mkdtemp(join(tmpdir(), "openhands-images-"));
    const imageBase64 = Buffer.from("fake png bytes").toString("base64");
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "done", durationMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    try {
      await runOpenHandsTurn(
        {
          projectId: "project-1",
          sessionId: "session-1",
          resumeSession: false,
          prompt: "inspect the screenshot",
          turnId: "turn-vision",
          modelId: "openrouter:openai/gpt-4o",
          projectRoot,
          attachments: [
            {
              name: "screenshot.png",
              mimeType: "image/png",
              dataBase64: imageBase64,
            },
          ],
          onEvent: () => {},
        },
        { spawn },
      );

      const mockFn = spawn as unknown as ReturnType<typeof vi.fn>;
      const [, argv] = mockFn.mock.calls[0] as [string, string[]];
      const manifestFlagIndex = argv.indexOf("--attachments-manifest");
      expect(manifestFlagIndex).toBeGreaterThanOrEqual(0);
      const manifestPath = argv[manifestFlagIndex + 1];
      expect(manifestPath).toContain(".agent-artifacts/openhands-attachments/turn-vision.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      expect(manifest).toEqual({
        imageUrls: [`data:image/png;base64,${imageBase64}`],
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("prefers explicit LLM bridge env values", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_API_KEY = "llm-test";
    process.env.OPENHANDS_BASE_URL = "https://openhands.example/v1";
    process.env.LLM_BASE_URL = "https://llm.example/v1";
    process.env.OPENHANDS_MAX_ITERATIONS = "8";
    process.env.OPENHANDS_ENABLE_PUBLIC_SKILLS = "1";
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "done", durationMs: 7, tokensIn: 3, tokensOut: 4, costUsd: 0.002 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "anthropic/claude-sonnet-4-6",
        onEvent: () => {},
      },
      { spawn },
    );

    const mockFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const [, , options] = mockFn.mock.calls[0] as [
      string,
      string[],
      { env?: NodeJS.ProcessEnv },
    ];
    expect(options.env).toMatchObject({
      LLM_MODEL: "anthropic/claude-sonnet-4-6",
      LLM_API_KEY: "llm-test",
      LLM_BASE_URL: "https://llm.example/v1",
      OPENHANDS_MAX_ITERATIONS: "8",
      OPENHANDS_ENABLE_PUBLIC_SKILLS: "1",
    });
  });

  it("emits agent.error when the bridge exits without a terminal JSONL event", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const events: BrokerToHost[] = [];
    const spawn = vi.fn(() =>
      makeFakeChild([JSON.stringify({ type: "chunk", delta: "Hi" })], 0, ["stderr tail"]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "openrouter/qwen/qwen3-coder:free",
        onEvent: (event) => events.push(event),
      },
      { spawn },
    );

    expect(events.at(-1)).toEqual<BrokerToHost>({
      type: "agent.error",
      turnId: "turn-1",
      message: "openhands bridge exited without terminal event (code 0)\nstderr tail",
    });
  });

  it("emits done with exitCode -1 after abort if no terminal bridge event was seen", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
      kill: (sig?: NodeJS.Signals | number) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn(() => {
      setImmediate(() => {
        (child.stdout as PassThrough).end();
        (child.stderr as PassThrough).end();
        child.emit("close", -1);
      });
      return true;
    });

    const events: BrokerToHost[] = [];
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener");
    const promise = runOpenHandsTurn(
      {
        projectId: "project-1",
        sessionId: "session-1",
        resumeSession: false,
        prompt: "hello",
        turnId: "turn-1",
        modelId: "openrouter/qwen/qwen3-coder:free",
        onEvent: (event) => events.push(event),
        signal: controller.signal,
      },
      { spawn: vi.fn(() => child) as unknown as OpenHandsSpawnFn },
    );

    setImmediate(() => controller.abort());
    await promise;

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(removeAbortListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(events.at(-1)).toEqual<BrokerToHost>({
      type: "agent.done",
      turnId: "turn-1",
      durationMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      exitCode: -1,
    });
  });

  it("runs reviewer pass in a fresh review session and tags emitted events", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const events: BrokerToHost[] = [];
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "status", phase: "thinking", detail: "reviewing" }),
        JSON.stringify({ type: "chunk", delta: "Passed" }),
        JSON.stringify({ type: "done", durationMs: 5, tokensIn: 1, tokensOut: 2, costUsd: 0 }),
      ]),
    ) as unknown as OpenHandsSpawnFn;

    await runOpenHandsReviewPass(
      {
        projectId: "project-1",
        turnId: "turn-1",
        onEvent: (event) => events.push(event),
      },
      { spawn },
    );

    expect(events[0]).toMatchObject({ type: "agent.status", agentId: "reviewer" });
    expect(events[1]).toMatchObject({ type: "agent.chunk", agentId: "reviewer" });
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining(["--session", "review-turn-1"]),
      expect.any(Object),
    );
  });
});
