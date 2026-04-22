import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";

// Load .env from monorepo root (this file lives at ws-proxy/src/index.ts,
// so `../../` from __dirname resolves to the repo root).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../.env") });

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

    let brokerUrl: string;
    try {
      brokerUrl = await opts.resolveBrokerUrl(projectId);
    } catch {
      browserSocket.close(1011, "broker resolve failed");
      return;
    }

    const brokerSocket = new WebSocket(brokerUrl);

    const forward = (from: WebSocket, to: WebSocket) => {
      from.on("message", (data: RawData) => {
        if (to.readyState === WebSocket.OPEN) to.send(data);
      });
      from.on("close", () => {
        if (to.readyState === WebSocket.OPEN) to.close();
      });
      from.on("error", () => {
        if (to.readyState === WebSocket.OPEN) to.close();
      });
    };

    // Buffer messages from browser that arrive before the broker connection opens
    const pendingFromBrowser: RawData[] = [];
    browserSocket.on("message", (data: RawData) => {
      if (brokerSocket.readyState === WebSocket.OPEN) {
        brokerSocket.send(data);
      } else {
        pendingFromBrowser.push(data);
      }
    });
    const tearDownBroker = () => {
      // Terminate regardless of readyState so a still-CONNECTING broker
      // socket doesn't leak after the browser disconnects.
      if (brokerSocket.readyState !== WebSocket.CLOSED) {
        brokerSocket.terminate();
      }
    };
    browserSocket.on("close", tearDownBroker);
    browserSocket.on("error", tearDownBroker);

    brokerSocket.once("open", () => {
      // Flush buffered messages
      for (const data of pendingFromBrowser) {
        brokerSocket.send(data);
      }
      pendingFromBrowser.length = 0;
      // Set up broker → browser forwarding
      forward(brokerSocket, browserSocket);
    });

    brokerSocket.once("error", () => {
      browserSocket.close(1011, "broker connection failed");
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

// Runnable entry point when invoked directly
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
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
