import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
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

function makeFakeChild(stdoutLines: string[], exitCode = 0) {
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
    expect(normalizeOpenHandsModelId(undefined)).toBe("");
  });

  it("emits agent.error when an OpenRouter model is selected without OPENROUTER_API_KEY", async () => {
    delete process.env.OPENROUTER_API_KEY;
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
        message: "openhands runtime requires OPENROUTER_API_KEY for OpenRouter models.",
      },
    ]);
  });

  it("streams bridge JSONL records to broker events", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
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
    expect(spawn).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([
        "/opt/builder/container/sandbox/broker/python/openhands_bridge.py",
        "--session-id",
        "session-1",
        "--resume",
        "--model",
        "openrouter/qwen/qwen3-coder:free",
      ]),
      expect.objectContaining({ cwd: "/workspace/project" }),
    );
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
      expect.arrayContaining(["--session-id", "review-turn-1"]),
      expect.any(Object),
    );
  });
});
