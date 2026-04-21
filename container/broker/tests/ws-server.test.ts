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
    handle = await startBroker({ port: 0 });
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
    handle = await startBroker({ port: 0 });
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
});
