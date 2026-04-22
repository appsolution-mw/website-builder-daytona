import { describe, it, expect, vi } from "vitest";
import { Readable, Writable, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { runClaudeTurn, type ClaudeRunnerDeps, type SpawnFn } from "../src/claude-runner";
import type { BrokerToHost } from "@wbd/protocol";

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
    for (const l of stdoutLines) (child.stdout as PassThrough).write(l + "\n");
    (child.stdout as PassThrough).end();
    (child.stderr as PassThrough).end();
    setImmediate(() => child.emit("close", exitCode));
  });
  return child;
}

describe("runClaudeTurn", () => {
  const baseOpts = {
    projectId: "p1",
    prompt: "change hi",
    turnId: "t-1",
  };

  it("streams parsed events to onEvent in order, then resolves on clean exit", async () => {
    const events: BrokerToHost[] = [];
    const deps: ClaudeRunnerDeps = {
      spawn: vi.fn(() =>
        makeFakeChild([
          JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Ok, editing." }] },
          }),
          JSON.stringify({
            type: "result",
            subtype: "success",
            duration_ms: 1000,
            usage: { input_tokens: 100, output_tokens: 20 },
            total_cost_usd: 0.001,
          }),
        ]),
      ) as unknown as SpawnFn,
    };

    await runClaudeTurn({ ...baseOpts, onEvent: (e) => events.push(e) }, deps);

    const types = events.map((e) => e.type);
    expect(types).toEqual(["agent.status", "agent.chunk", "agent.done"]);
  });

  it("passes the correct argv to spawn (no --max-turns, has other flags)", async () => {
    const spawn = vi.fn(() =>
      makeFakeChild([
        JSON.stringify({ type: "result", subtype: "success", duration_ms: 1 }),
      ]),
    ) as unknown as SpawnFn;
    await runClaudeTurn({ ...baseOpts, onEvent: () => {} }, { spawn });
    const mockFn = spawn as unknown as ReturnType<typeof vi.fn>;
    const [cmd, argv] = mockFn.mock.calls[0] as [string, string[], ...unknown[]];
    expect(cmd).toBe("claude");
    expect(argv).toContain("--print");
    expect(argv).toContain(baseOpts.prompt);
    expect(argv).toContain("--output-format");
    expect(argv).toContain("stream-json");
    expect(argv).toContain("--verbose");
    expect(argv).toContain("--session-id");
    expect(argv).toContain("--model");
    expect(argv).toContain("--dangerously-skip-permissions");
    // --max-turns is NOT supported in Claude Code v2.1.116+; must not be passed
    expect(argv).not.toContain("--max-turns");
  });

  it("emits agent.error when process exits non-zero without a result line", async () => {
    const events: BrokerToHost[] = [];
    const deps: ClaudeRunnerDeps = {
      spawn: vi.fn(() =>
        makeFakeChild(
          [JSON.stringify({ type: "system", subtype: "init", session_id: "s" })],
          2,
        ),
      ) as unknown as SpawnFn,
    };
    await runClaudeTurn({ ...baseOpts, onEvent: (e) => events.push(e) }, deps);
    const last = events[events.length - 1];
    expect(last?.type).toBe("agent.error");
  });

  it("kills the child when abort signal fires, then resolves", async () => {
    // Custom fake: doesn't auto-exit. Wait for abort to trigger close.
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable;
      stderr: Readable;
      stdin: Writable;
      kill: (sig?: NodeJS.Signals | number) => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const killSpy = vi.fn(() => {
      setImmediate(() => {
        (child.stdout as PassThrough).end();
        (child.stderr as PassThrough).end();
        child.emit("close", -1);
      });
      return true;
    });
    child.kill = killSpy;

    const deps: ClaudeRunnerDeps = { spawn: vi.fn(() => child) as unknown as SpawnFn };
    const ctl = new AbortController();
    const events: BrokerToHost[] = [];

    const p = runClaudeTurn(
      { ...baseOpts, onEvent: (e) => events.push(e), signal: ctl.signal },
      deps,
    );
    setImmediate(() => ctl.abort());
    await p;

    expect(killSpy).toHaveBeenCalled();
    const last = events[events.length - 1];
    expect(last?.type).toBe("agent.done");
    expect(last && last.type === "agent.done" && last.exitCode).toBe(-1);
  });
});
