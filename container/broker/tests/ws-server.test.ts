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
});
