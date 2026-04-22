import { describe, it, expect, afterEach, beforeEach } from "vitest";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";
import { startProxy, type ProxyHandle, extractProjectId } from "../src/index";

// Minimal mock broker: accepts connections, echoes ping → pong.
function startMockBroker(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.once("error", reject);
    wss.once("listening", () => {
      wss.on("connection", (socket) => {
        socket.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", nonce: msg.nonce }));
          }
        });
      });
      const addr = wss.address() as AddressInfo;
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res, rej) =>
            wss.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

describe("ws-proxy", () => {
  let broker: Awaited<ReturnType<typeof startMockBroker>> | undefined;
  let proxy: ProxyHandle | undefined;

  beforeEach(async () => {
    broker = await startMockBroker();
    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: () => `ws://localhost:${broker!.port}`,
    });
  });

  afterEach(async () => {
    await proxy?.close();
    await broker?.close();
  });

  it("forwards browser → broker and broker → browser", async () => {
    const client = new WebSocket(`ws://localhost:${proxy!.port}/p/test-project`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "ping", nonce: "proxy-test" }));
    });

    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "proxy-test" });
    client.close();
  });

  it("buffers browser messages while broker URL resolution is pending", async () => {
    await proxy?.close();
    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `ws://localhost:${broker!.port}`;
      },
    });

    const client = new WebSocket(`ws://localhost:${proxy.port}/p/test-project`);
    const reply = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for pong")), 1000);
      client.once("open", () => {
        client.send(JSON.stringify({ type: "ping", nonce: "early-message" }));
      });
      client.once("message", (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      client.once("error", reject);
    });

    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "early-message" });
    client.close();
  });

  it("preserves text-frame semantics when forwarding", async () => {
    const client = new WebSocket(`ws://localhost:${proxy!.port}/p/test-project`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const { data, isBinary } = await new Promise<{ data: unknown; isBinary: boolean }>((resolve) => {
      client.once("message", (d, isBin) => resolve({ data: d, isBinary: isBin }));
      client.send(JSON.stringify({ type: "ping", nonce: "text-check" }));
    });

    expect(isBinary).toBe(false);
    expect(Buffer.isBuffer(data)).toBe(true);
    client.close();
  });
});

describe("extractProjectId", () => {
  it("extracts from /p/abc", () => {
    expect(extractProjectId("/p/abc")).toBe("abc");
  });
  it("extracts with query string", () => {
    expect(extractProjectId("/p/abc?foo=bar")).toBe("abc");
  });
  it("returns null for wrong path", () => {
    expect(extractProjectId("/wrong/abc")).toBeNull();
  });
  it("decodes URL-encoded id", () => {
    expect(extractProjectId("/p/abc%20def")).toBe("abc def");
  });
});
