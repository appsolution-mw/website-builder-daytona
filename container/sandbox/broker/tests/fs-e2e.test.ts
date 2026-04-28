import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBroker, type BrokerHandle } from "../src/ws-server";

describe("broker fs-e2e", () => {
  let handle: BrokerHandle | undefined;
  let root = "";

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("streams file.changed for an external edit after ready", async () => {
    root = await mkdtemp(join(tmpdir(), "wbd-fse2e-"));
    await writeFile(join(root, "a.ts"), "initial");
    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: true });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: Array<Record<string, unknown>> = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    await writeFile(join(root, "b.ts"), "new");

    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (events.some((e) => e.type === "file.changed" && e.path === "b.ts" && e.event === "add")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(
      events.some((e) => e.type === "file.changed" && e.path === "b.ts" && e.event === "add"),
    ).toBe(true);

    client.close();
  });

  it("file.list reflects new files added after ready", async () => {
    root = await mkdtemp(join(tmpdir(), "wbd-fse2e-list-"));
    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: true });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    await writeFile(join(root, "x.ts"), "x");
    await new Promise((r) => setTimeout(r, 200));

    const reply = await new Promise<{ paths?: string[] }>((resolve) => {
      const onMsg = (data: RawData) => {
        const parsed = JSON.parse(data.toString()) as { type?: string; paths?: string[] };
        if (parsed.type === "file.list.result") {
          client.off("message", onMsg);
          resolve(parsed);
        }
      };
      client.on("message", onMsg);
      client.send(JSON.stringify({ type: "file.list", requestId: "L1" }));
    });

    expect(reply.paths).toContain("x.ts");
    client.close();
  });

  it("file.write produces a file.changed event (atomic rename)", async () => {
    root = await mkdtemp(join(tmpdir(), "wbd-fse2e-write-"));
    handle = await startBroker({ port: 0, projectRoot: root, enableFsTracker: true });

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));

    const events: Array<Record<string, unknown>> = [];
    client.on("message", (data) => events.push(JSON.parse(data.toString())));

    client.send(
      JSON.stringify({
        type: "file.write",
        requestId: "W1",
        path: "written.ts",
        content: "hello",
      }),
    );

    const start = Date.now();
    while (Date.now() - start < 5000) {
      const wrote = events.find((e) => e.type === "file.write.result" && e.requestId === "W1");
      const changed = events.filter((e) => e.type === "file.changed" && e.path === "written.ts");
      if (wrote && changed.length >= 1) {
        expect(wrote.ok).toBe(true);
        expect(changed.length).toBeLessThanOrEqual(2);
        client.close();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `expected write+changed but saw events: ${JSON.stringify(events, null, 2)}`,
    );
  });
});
