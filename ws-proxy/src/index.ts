import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { AgentUsageEvent } from "@wbd/protocol";
import type { Prisma } from "@prisma/client";

// Load .env from monorepo root (this file lives at ws-proxy/src/index.ts,
// so `../../` from __dirname resolves to the repo root).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../.env") });

const BROKER_CONNECT_TIMEOUT_MS = 8_000;

export interface ProxyHandle {
  port: number;
  close: () => Promise<void>;
}

export interface StartProxyOptions {
  port: number;
  /**
   * Given a projectId (extracted from the URL path `/p/:projectId`),
   * return the broker WebSocket URL to connect to.
   * In this milestone all projects point at the same local broker.
   */
  resolveBrokerUrl: (projectId: string) => string | Promise<string>;
  recordTokenUsage?: (
    projectId: string,
    event: AgentUsageEvent,
  ) => void | Promise<void>;
}

function parseUsageEvent(data: RawData, isBinary: boolean): AgentUsageEvent | null {
  if (isBinary) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as Partial<AgentUsageEvent>;
  return msg.type === "agent.usage" && typeof msg.turnId === "string" ? (msg as AgentUsageEvent) : null;
}

export async function startProxy(opts: StartProxyOptions): Promise<ProxyHandle> {
  const wss = new WebSocketServer({ port: opts.port });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("proxy did not bind to a numeric port");
  }

  wss.on("connection", async (browserSocket, request) => {
    const projectId = extractProjectId(request.url ?? "");
    if (!projectId) {
      browserSocket.close(1008, "missing project id");
      return;
    }

    // Keepalive for the browser leg: ping every 25s so intermediate proxies
    // don't idle-close during long Claude turns. Browser WS stacks auto-reply
    // to ping frames.
    let browserAlive = true;
    browserSocket.on("pong", () => {
      browserAlive = true;
    });
    const browserPingTimer = setInterval(() => {
      if (!browserAlive) {
        browserSocket.terminate();
        return;
      }
      browserAlive = false;
      browserSocket.ping();
    }, 25_000);
    browserSocket.on("close", () => clearInterval(browserPingTimer));

    let brokerSocket: WebSocket | null = null;
    let brokerPingTimer: ReturnType<typeof setInterval> | null = null;
    const pendingFromBrowser: Array<{ data: RawData; isBinary: boolean }> = [];

    // Register immediately. The browser may send its first request right after
    // its websocket opens, while broker URL resolution still awaits the DB.
    browserSocket.on("message", (data: RawData, isBinary: boolean) => {
      if (brokerSocket?.readyState === WebSocket.OPEN) {
        brokerSocket.send(data, { binary: isBinary });
      } else {
        pendingFromBrowser.push({ data, isBinary });
      }
    });

    let brokerUrl: string;
    try {
      brokerUrl = await opts.resolveBrokerUrl(projectId);
    } catch {
      browserSocket.close(1011, "broker resolve failed");
      return;
    }

    brokerSocket = new WebSocket(brokerUrl, {
      handshakeTimeout: BROKER_CONNECT_TIMEOUT_MS,
    });
    let brokerOpened = false;
    const brokerConnectTimer = setTimeout(() => {
      if (brokerSocket.readyState === WebSocket.CONNECTING) {
        console.error(`[ws-proxy] broker connect timeout for project ${projectId}`);
        brokerSocket.terminate();
        if (browserSocket.readyState === WebSocket.OPEN) {
          browserSocket.close(1011, "broker connection timeout");
        }
      }
    }, BROKER_CONNECT_TIMEOUT_MS);

    const forward = (
      from: WebSocket,
      to: WebSocket,
      onMessage?: (data: RawData, isBinary: boolean) => void,
    ) => {
      from.on("message", (data: RawData, isBinary: boolean) => {
        onMessage?.(data, isBinary);
        if (to.readyState === WebSocket.OPEN) to.send(data, { binary: isBinary });
      });
      from.on("close", () => {
        if (to.readyState === WebSocket.OPEN) to.close();
      });
      from.on("error", () => {
        if (to.readyState === WebSocket.OPEN) to.close();
      });
    };

    const tearDownBroker = () => {
      // Terminate regardless of readyState so a still-CONNECTING broker
      // socket doesn't leak after the browser disconnects.
      if (brokerSocket && brokerSocket.readyState !== WebSocket.CLOSED) {
        brokerSocket.terminate();
      }
    };
    browserSocket.on("close", tearDownBroker);
    browserSocket.on("error", tearDownBroker);

    brokerSocket.once("open", () => {
      brokerOpened = true;
      clearTimeout(brokerConnectTimer);
      // Keepalive for the broker leg too (ws-proxy acts as WS client here).
      // Daytona's HTTPS reverse proxy idle-closes WSS connections after a
      // short silence; pings prevent that during long Claude turns.
      let brokerAlive = true;
      brokerSocket.on("pong", () => {
        brokerAlive = true;
      });
      brokerPingTimer = setInterval(() => {
        if (!brokerSocket || brokerSocket.readyState !== WebSocket.OPEN) return;
        if (!brokerAlive) {
          brokerSocket.terminate();
          return;
        }
        brokerAlive = false;
        brokerSocket.ping();
      }, 25_000);
      brokerSocket.on("close", () => {
        if (brokerPingTimer) {
          clearInterval(brokerPingTimer);
          brokerPingTimer = null;
        }
      });
      // Flush buffered messages
      for (const { data, isBinary } of pendingFromBrowser) {
        brokerSocket.send(data, { binary: isBinary });
      }
      pendingFromBrowser.length = 0;
      // Set up broker → browser forwarding
      forward(brokerSocket, browserSocket, (data, isBinary) => {
        const usage = parseUsageEvent(data, isBinary);
        if (!usage || !opts.recordTokenUsage) return;
        void Promise.resolve(opts.recordTokenUsage(projectId, usage)).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ws-proxy] failed to persist token usage for project ${projectId}: ${message}`);
        });
      });
    });

    brokerSocket.once("error", (err) => {
      clearTimeout(brokerConnectTimer);
      console.error(`[ws-proxy] broker connection failed for project ${projectId}: ${err.message}`);
      if (browserSocket.readyState === WebSocket.OPEN) {
        browserSocket.close(1011, "broker connection failed");
      }
    });

    brokerSocket.once("close", (code, reason) => {
      clearTimeout(brokerConnectTimer);
      if (!brokerOpened && browserSocket.readyState === WebSocket.OPEN) {
        const detail = reason.toString() || `code ${code}`;
        console.error(`[ws-proxy] broker closed before open for project ${projectId}: ${detail}`);
        browserSocket.close(1011, "broker connection closed");
      }
    });
  });

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Extracts `:projectId` from a URL like `/p/:projectId`. */
export function extractProjectId(url: string): string | null {
  const match = url.match(/^\/p\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function dbUsageLabel(label: AgentUsageEvent["label"]) {
  if (label === "coder") return "CODER";
  if (label === "reviewer") return "REVIEWER";
  return "TURN";
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

// Runnable entry point when invoked directly
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  void main();
}

async function main() {
  const { prisma } = await import("./db");
  const port = Number(process.env.WS_PROXY_PORT ?? 4100);
  const handle = await startProxy({
    port,
    resolveBrokerUrl: async (projectId) => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { brokerUrl: true, status: true },
      });
      if (!project || project.status !== "RUNNING" || !project.brokerUrl) {
        throw new Error(`project ${projectId} is not running`);
      }
      return project.brokerUrl;
    },
    recordTokenUsage: async (projectId, event) => {
      const usage = event.usage;
      await prisma.tokenUsage.upsert({
        where: {
          projectId_turnId_label: {
            projectId,
            turnId: event.turnId,
            label: dbUsageLabel(event.label),
          },
        },
        create: {
          projectId,
          turnId: event.turnId,
          label: dbUsageLabel(event.label),
          durationMs: event.durationMs,
          inputTokens: usage?.inputTokens ?? event.tokensIn,
          outputTokens: usage?.outputTokens ?? event.tokensOut,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
          cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? event.tokensIn + event.tokensOut,
          webSearchRequests: usage?.webSearchRequests ?? 0,
          webFetchRequests: usage?.webFetchRequests ?? 0,
          costUsd: event.costUsd,
          exitCode: event.exitCode,
          serviceTier: usage?.serviceTier,
          inferenceGeo: usage?.inferenceGeo,
          rawUsage: jsonOrUndefined(usage?.rawUsage),
          modelUsage: jsonOrUndefined(usage?.modelUsage),
        },
        update: {
          durationMs: event.durationMs,
          inputTokens: usage?.inputTokens ?? event.tokensIn,
          outputTokens: usage?.outputTokens ?? event.tokensOut,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
          cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? event.tokensIn + event.tokensOut,
          webSearchRequests: usage?.webSearchRequests ?? 0,
          webFetchRequests: usage?.webFetchRequests ?? 0,
          costUsd: event.costUsd,
          exitCode: event.exitCode,
          serviceTier: usage?.serviceTier,
          inferenceGeo: usage?.inferenceGeo,
          rawUsage: jsonOrUndefined(usage?.rawUsage),
          modelUsage: jsonOrUndefined(usage?.modelUsage),
        },
      });
    },
  });
  console.log(`[ws-proxy] listening on ws://localhost:${handle.port}`);
  const shutdown = async () => {
    await handle.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
