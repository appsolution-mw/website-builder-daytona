import { describe, it, expect, afterEach, beforeEach } from "vitest";
import WebSocket, { WebSocketServer, type AddressInfo } from "ws";
import { startProxy, type ProxyHandle, extractProjectId } from "../src/index";
import type { AgentUsageEvent, ProxyToBrowser } from "@wbd/protocol";

// Minimal mock broker: accepts connections, echoes ping → pong.
function startMockBroker(opts: {
  onConnection?: (socket: WebSocket) => void;
} = {}): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.once("error", reject);
    wss.once("listening", () => {
      wss.on("connection", (socket) => {
        opts.onConnection?.(socket);
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

  it("records token usage events while forwarding broker messages", async () => {
    await proxy?.close();
    await broker?.close();

    const usageEvent: AgentUsageEvent = {
      type: "agent.usage",
      turnId: "turn-1",
      label: "turn",
      durationMs: 1000,
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 0.012,
      exitCode: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 40,
        totalTokens: 100,
        webSearchRequests: 1,
        webFetchRequests: 2,
        rawUsage: { input_tokens: 10 },
      },
    };
    broker = await startMockBroker({
      onConnection: (socket) => {
        socket.once("message", () => socket.send(JSON.stringify(usageEvent)));
      },
    });

    const recorded: Array<{ projectId: string; event: AgentUsageEvent }> = [];
    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: () => `ws://localhost:${broker!.port}`,
      recordTokenUsage: (projectId, event) => {
        recorded.push({ projectId, event });
      },
    });

    const client = new WebSocket(`ws://localhost:${proxy.port}/p/test-project`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const reply = await new Promise<string>((resolve) => {
      client.once("message", (data) => resolve(data.toString()));
      client.send(JSON.stringify({ type: "ping", nonce: "usage" }));
    });

    expect(JSON.parse(reply)).toEqual(usageEvent);
    expect(recorded).toEqual([{ projectId: "test-project", event: usageEvent }]);
    client.close();
  });

  it("forwards git.commit and git.commit.skipped frames unmodified to the browser", async () => {
    // Regression for T-20260509-006 / Phase 1.4a Task 7. The ws-proxy is a
    // typed pass-through: any BrokerToHost frame must reach the browser leg
    // byte-for-byte. If a future change introduces an event-type allowlist or
    // switch, this test will fail and force an explicit decision.
    await proxy?.close();
    await broker?.close();

    const commitEvent: ProxyToBrowser = {
      type: "git.commit",
      turnId: "turn-42",
      sha: "0123456789abcdef0123456789abcdef01234567",
      shortSha: "0123456",
      title: "feat: add forwarding regression test",
      bodyMessage: "",
      filesChanged: 1,
      insertions: 10,
      deletions: 0,
      runtime: "claude-code",
      modelId: "claude-opus-4-7",
      authorKind: "AGENT",
      committedAt: "2026-05-09T12:00:00.000Z",
    };
    const skippedEvent: ProxyToBrowser = {
      type: "git.commit.skipped",
      turnId: "turn-42",
      reason: "no_changes",
    };

    broker = await startMockBroker({
      onConnection: (socket) => {
        socket.once("message", () => {
          socket.send(JSON.stringify(commitEvent));
          socket.send(JSON.stringify(skippedEvent));
        });
      },
    });

    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: () => `ws://localhost:${broker!.port}`,
    });

    const client = new WebSocket(`ws://localhost:${proxy.port}/p/test-project`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const received: ProxyToBrowser[] = await new Promise((resolve, reject) => {
      const collected: ProxyToBrowser[] = [];
      const timeout = setTimeout(
        () => reject(new Error("timed out waiting for forwarded frames")),
        1000,
      );
      client.on("message", (data) => {
        collected.push(JSON.parse(data.toString()) as ProxyToBrowser);
        if (collected.length === 2) {
          clearTimeout(timeout);
          resolve(collected);
        }
      });
      client.send(JSON.stringify({ type: "ping", nonce: "kick" }));
    });

    expect(received[0]).toEqual(commitEvent);
    expect(received[1]).toEqual(skippedEvent);
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
