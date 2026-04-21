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

  it("starts, accepts a connection, and closes cleanly", async () => {
    handle = await startBroker({ port: 0 });
    expect(handle.port).toBeGreaterThan(0);

    const client = new WebSocket(`ws://localhost:${handle.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });
    client.close();
  });
});
