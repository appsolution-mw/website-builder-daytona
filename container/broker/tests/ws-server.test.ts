import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { startBroker, type BrokerHandle } from "../src/ws-server";

describe("broker ws server", () => {
  let handle: BrokerHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it("starts, accepts a connection, and tears it down on close()", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    expect(handle.port).toBeGreaterThan(0);

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    // Let handle.close() (from afterEach) terminate the client. Assert the
    // client sees a close event as a result.
    await Promise.all([
      new Promise<void>((resolve) => client.once("close", () => resolve())),
      handle.close(),
    ]);
    handle = undefined;
  });

  it("echoes ping → pong over a real socket", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const reply = await new Promise<string>((resolve, reject) => {
      client.once("message", (data) => resolve(data.toString()));
      client.once("error", reject);
      client.send(JSON.stringify({ type: "ping", nonce: "xyz" }));
    });

    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "xyz" });
    client.close();
  });

  it("rejects a second agent.prompt while the first is still running", async () => {
    handle = await startBroker({ port: 0, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const errors: unknown[] = [];
    client.on("message", (d) => errors.push(JSON.parse(d.toString())));

    client.send(JSON.stringify({ type: "agent.prompt", prompt: "first", turnId: "t1" }));
    client.send(JSON.stringify({ type: "agent.prompt", prompt: "second", turnId: "t2" }));

    // Wait briefly for the broker to process and reject the second message
    await new Promise((r) => setTimeout(r, 200));

    const secondRejection = errors.find(
      (e): e is { type: "agent.error"; turnId: string; message: string } =>
        typeof e === "object" &&
        e !== null &&
        (e as { type?: string }).type === "agent.error" &&
        (e as { turnId?: string }).turnId === "t2",
    );
    expect(secondRejection).toBeDefined();
    expect(secondRejection?.message).toMatch(/already running/);
    client.close();
  });

  it("responds to file.list with sorted paths", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-list-"));
    await writeFile(join(root, "b.ts"), "b");
    await writeFile(join(root, "a.ts"), "a");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: true });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "file.list", requestId: "r1" }));
    });

    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("file.list.result");
    expect(parsed.requestId).toBe("r1");
    expect(parsed.paths).toEqual(["a.ts", "b.ts"]);
    client.close();
  });

  it("responds to file.read with content for a text file", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wbd-ws-read-"));
    await writeFile(join(root, "hi.txt"), "hello!");

    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "file.read", requestId: "r2", path: "hi.txt" }));
    });

    expect(JSON.parse(reply)).toEqual({
      type: "file.content",
      requestId: "r2",
      path: "hi.txt",
      content: "hello!",
    });
    client.close();
  });

  it("refuses file.write with reason:locked while a turn is running", async () => {
    handle = await startBroker({ port: 0, projectRoot: process.cwd(), enableFsTracker: false });
    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const replies: unknown[] = [];
    client.on("message", (data) => replies.push(JSON.parse(data.toString())));

    client.send(JSON.stringify({ type: "agent.prompt", prompt: "x", turnId: "t1" }));
    client.send(JSON.stringify({ type: "file.write", requestId: "w1", path: "x.txt", content: "y" }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      const write = replies.find(
        (r: unknown) =>
          typeof r === "object" && r !== null &&
          (r as { type?: string }).type === "file.write.result" &&
          (r as { requestId?: string }).requestId === "w1",
      );
      if (write) {
        expect((write as { ok: boolean }).ok).toBe(false);
        expect((write as { reason?: string }).reason).toBe("locked");
        client.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("never saw file.write.result");
  });

  it("runs reviewer after coder turn that wrote files", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      // coder
      {
        stdout: [
          { type: "system", subtype: "init" },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "tu-write-1",
                  name: "Write",
                  input: { file_path: "/workspace/project/x.txt", content: "ok" },
                },
                { type: "text", text: "wrote x.txt" },
              ],
            },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 1000,
            usage: { input_tokens: 5, output_tokens: 10 },
            total_cost_usd: 0.002,
          },
        ],
      },
      // reviewer
      {
        stdout: [
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "✅ Passed" }] },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 200,
            usage: { input_tokens: 2, output_tokens: 3 },
            total_cost_usd: 0.0005,
          },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify({ type: "agent.prompt", prompt: "write x", turnId: "t1" }));

    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.done" && (e as { turnId?: string }).turnId === "t1")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(2);
    const reviewerArgv = spawns[1].argv;
    expect(reviewerArgv[reviewerArgv.indexOf("--print") + 1]).toMatch(/reviewer sub-agent/i);

    const reviewing = events.find(
      (e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing",
    );
    expect(reviewing).toBeDefined();

    const reviewerChunk = events.find(
      (e) => (e as { type?: string; agentId?: string }).type === "agent.chunk" && (e as { agentId?: string }).agentId === "reviewer",
    );
    expect(reviewerChunk).toBeDefined();

    const dones = events.filter((e) => (e as { type?: string }).type === "agent.done");
    expect(dones.length).toBe(1);
    const done = dones[0] as { tokensIn: number; tokensOut: number; durationMs: number; costUsd: number };
    expect(done.tokensIn).toBe(5 + 2);
    expect(done.tokensOut).toBe(10 + 3);
    expect(done.durationMs).toBe(1000 + 200);
    expect(done.costUsd).toBeCloseTo(0.002 + 0.0005, 6);

    client.close();
  });

  it("skips reviewer when coder wrote no files", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          { type: "system", subtype: "init" },
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "This project uses Next.js." }] },
          },
          {
            type: "result",
            subtype: "success",
            duration_ms: 400,
            usage: { input_tokens: 3, output_tokens: 5 },
            total_cost_usd: 0.001,
          },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify({ type: "agent.prompt", prompt: "what is this?", turnId: "t2" }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.done" && (e as { turnId?: string }).turnId === "t2")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(1);
    expect(events.some((e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing")).toBe(false);
    client.close();
  });

  it("skips reviewer when coder emits an error", async () => {
    const { spawnsSetup } = await import("../src/__testutil__/fake-spawn");
    const { fakeSpawn, spawns } = spawnsSetup([
      {
        stdout: [
          { type: "system", subtype: "init" },
          { type: "result", subtype: "error_max_turns" },
        ],
      },
    ]);

    handle = await startBroker({
      port: 0,
      enableFsTracker: false,
      __testSpawn: fakeSpawn,
    });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: unknown[] = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(JSON.stringify({ type: "agent.prompt", prompt: "foo", turnId: "t3" }));

    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (events.some((e) => (e as { type?: string; turnId?: string }).type === "agent.error" && (e as { turnId?: string }).turnId === "t3")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(spawns.length).toBe(1);
    expect(events.some((e) => (e as { type?: string }).type === "agent.error")).toBe(true);
    expect(events.some((e) => (e as { type?: string; phase?: string }).type === "agent.status" && (e as { phase?: string }).phase === "reviewing")).toBe(false);
    client.close();
  });
});
