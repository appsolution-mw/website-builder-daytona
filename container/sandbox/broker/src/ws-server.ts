import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  HostToBroker,
  BrokerToHost,
} from "@wbd/protocol";
import { handleMessage } from "./handlers";
import type { SpawnFn } from "./claude-runner";
import { agentRuntimeFromEnv } from "./agent-provider";
import { createFsTracker, type FsTracker } from "./fs-tracker";
import {
  handleFileDelete,
  handleFileList,
  handleFileRead,
  handleFileWrite,
} from "./fs-handlers";
import {
  startInteractiveTerminal,
  startTerminalCommand,
  type InteractiveTerminalHandle,
  type PtySpawnFn,
  type TerminalCommandHandle,
} from "./terminal-runner";

export interface BrokerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface StartBrokerOptions {
  port: number;
  projectRoot?: string;
  enableFsTracker?: boolean;
  /** Test-only: override child_process.spawn used by claude-runner. */
  __testSpawn?: SpawnFn;
  /** Test-only: override node-pty spawn used by the interactive terminal. */
  __testPtySpawn?: PtySpawnFn;
  onDrainProjectQueue?: (projectId: string) => Promise<void> | void;
  onCancelProjectRun?: (projectId: string, runId: string) => Promise<void> | void;
}

const MAX_TERMINAL_COMMAND_BYTES = 8192;

export async function startBroker(opts: StartBrokerOptions): Promise<BrokerHandle> {
  const projectRoot = opts.projectRoot ?? "/workspace/project";
  const enableFsTracker = opts.enableFsTracker ?? true;
  console.log(`[broker] default agent runtime=${agentRuntimeFromEnv()}`);

  const server = createServer((req, res) => {
    void handleInternalHttpRequest(req, res, opts).catch(() => {
      if (!res.writableEnded) {
        writeJson(res, 500, { error: "internal" });
      }
    });
  });
  const wss = new WebSocketServer({ server });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(opts.port);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("ws server did not bind to a numeric port");
  }

  const isAgentActive = () => false;
  const isLocked = () => false;

  const broadcast = (msg: BrokerToHost) => {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  let tracker: FsTracker | undefined;
  if (enableFsTracker) {
    tracker = await createFsTracker({
      root: projectRoot,
      isAgentActive,
      onEvent: (e) => {
        broadcast({
          type: "file.changed",
          path: e.path,
          event: e.event,
          source: e.source,
        });
      },
    });
  }

  wss.on("connection", (socket: WebSocket) => {
    let terminalCommand: TerminalCommandHandle | null = null;
    let interactiveTerminal: InteractiveTerminalHandle | null = null;

    const send = (obj: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    };

    // Keepalive: ping every 25s. Prevents intermediate proxies (Daytona's
    // HTTPS reverse proxy) from idle-closing the WSS during long Claude turns
    // where NDJSON events can pause for minutes. Browsers auto-reply to ping
    // frames; for the ws→ws leg, the ws-proxy replies via `ws` lib defaults.
    let isAlive = true;
    socket.on("pong", () => {
      isAlive = true;
    });
    const pingTimer = setInterval(() => {
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, 25_000);

    socket.on("error", (err) => {
      console.error("socket error:", err);
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      terminalCommand?.abort();
      interactiveTerminal?.close();
    });

    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        send({ type: "error", code: "invalid_json", message: "Message was not valid JSON" });
        return;
      }

      const msg = parsed as HostToBroker;

      if (msg.type === "agent.prompt") {
        send({
          type: "agent.error",
          turnId: msg.turnId,
          message: "agent.prompt over broker WebSocket is deprecated; enqueue runs through the host API.",
        });
        return;
      }

      if (msg.type === "agent.abort") {
        console.log(
          `[broker] agent.abort received turn=${msg.turnId}; durable runs are cancelled through the host API`,
        );
        send({
          type: "agent.error",
          turnId: msg.turnId,
          message: "agent.abort over broker WebSocket is deprecated; cancel runs through the host API.",
        });
        return;
      }

      if (msg.type === "terminal.run") {
        if (isLocked()) {
          send({
            type: "terminal.exit",
            requestId: msg.requestId,
            ok: false,
            exitCode: null,
            signal: null,
            reason: "locked",
          });
          return;
        }
        if (terminalCommand) {
          send({
            type: "terminal.exit",
            requestId: msg.requestId,
            ok: false,
            exitCode: null,
            signal: null,
            reason: "busy",
          });
          return;
        }
        const command = typeof msg.command === "string" ? msg.command.trim() : "";
        if (!command || Buffer.byteLength(command, "utf8") > MAX_TERMINAL_COMMAND_BYTES) {
          send({
            type: "terminal.exit",
            requestId: msg.requestId,
            ok: false,
            exitCode: null,
            signal: null,
            reason: "invalid_command",
          });
          return;
        }

        const handle = startTerminalCommand({
          requestId: msg.requestId,
          command,
          cwd: projectRoot,
          onEvent: send,
        });
        terminalCommand = handle;
        handle.done.finally(() => {
          if (terminalCommand?.requestId === handle.requestId) terminalCommand = null;
        });
        return;
      }

      if (msg.type === "terminal.open") {
        if (isLocked()) {
          send({
            type: "terminal.exit",
            requestId: msg.requestId,
            ok: false,
            exitCode: null,
            signal: null,
            reason: "locked",
          });
          return;
        }
        if (interactiveTerminal) {
          send({
            type: "terminal.exit",
            requestId: msg.requestId,
            ok: false,
            exitCode: null,
            signal: null,
            reason: "busy",
          });
          return;
        }
        const handle = startInteractiveTerminal({
          requestId: msg.requestId,
          cwd: projectRoot,
          cols: msg.cols,
          rows: msg.rows,
          onEvent: (event) => {
            if (event.type === "terminal.exit" && interactiveTerminal?.requestId === event.requestId) {
              interactiveTerminal = null;
            }
            send(event);
          },
          spawn: opts.__testPtySpawn,
        });
        interactiveTerminal = handle;
        return;
      }

      if (msg.type === "terminal.input") {
        if (interactiveTerminal?.requestId === msg.requestId) {
          interactiveTerminal.write(msg.data);
        }
        return;
      }

      if (msg.type === "terminal.resize") {
        if (interactiveTerminal?.requestId === msg.requestId) {
          interactiveTerminal.resize(msg.cols, msg.rows);
        }
        return;
      }

      if (msg.type === "terminal.close") {
        if (interactiveTerminal?.requestId === msg.requestId) {
          interactiveTerminal.close();
        }
        return;
      }

      if (msg.type === "terminal.abort") {
        if (terminalCommand?.requestId === msg.requestId) {
          terminalCommand.abort();
        }
        return;
      }

      if (msg.type === "file.list") {
        if (!tracker) {
          send({ type: "file.list.result", requestId: msg.requestId, paths: [] });
          return;
        }
        const r = handleFileList(tracker);
        send({ type: "file.list.result", requestId: msg.requestId, paths: r.paths });
        return;
      }

      if (msg.type === "file.read") {
        handleFileRead({ root: projectRoot, path: msg.path })
          .then((r) => {
            send({
              type: "file.content",
              requestId: msg.requestId,
              path: r.path,
              ...(r.content !== undefined ? { content: r.content } : {}),
              ...(r.error ? { error: r.error } : {}),
            });
          })
          .catch(() => {
            send({
              type: "file.content",
              requestId: msg.requestId,
              path: msg.path,
              error: "io_error",
            });
          });
        return;
      }

      if (msg.type === "file.write") {
        handleFileWrite({
          root: projectRoot,
          path: msg.path,
          content: msg.content,
          isLocked,
        })
          .then((r) => {
            send({
              type: "file.write.result",
              requestId: msg.requestId,
              path: r.path,
              ok: r.ok,
              ...(r.reason ? { reason: r.reason } : {}),
            });
          })
          .catch(() => {
            send({
              type: "file.write.result",
              requestId: msg.requestId,
              path: msg.path,
              ok: false,
              reason: "io_error",
            });
          });
        return;
      }

      if (msg.type === "file.delete") {
        handleFileDelete({
          root: projectRoot,
          path: msg.path,
          cleanupEmptyParents: msg.cleanupEmptyParents,
          isLocked,
        })
          .then((r) => {
            send({
              type: "file.delete.result",
              requestId: msg.requestId,
              path: r.path,
              ok: r.ok,
              ...(r.reason ? { reason: r.reason } : {}),
            });
          })
          .catch(() => {
            send({
              type: "file.delete.result",
              requestId: msg.requestId,
              path: msg.path,
              ok: false,
              reason: "io_error",
            });
          });
        return;
      }

      const reply = handleMessage(msg);
      if (reply) send(reply);
    });
  });

  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      if (tracker) await tracker.close();
    },
  };
}

async function handleInternalHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartBrokerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/internal/")) {
    writeJson(res, 426, { error: "upgrade-required" });
    return;
  }
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "method-not-allowed" });
    return;
  }

  const authResult = verifyBrokerBearer(req.headers.authorization);
  if (!authResult.ok) {
    writeJson(res, authResult.statusCode, { error: authResult.error });
    return;
  }

  const drainMatch = /^\/internal\/projects\/([^/]+)\/queue\/drain$/.exec(url.pathname);
  if (drainMatch) {
    const projectId = decodeURIComponent(drainMatch[1]);
    await (opts.onDrainProjectQueue ?? noop)(projectId);
    writeJson(res, 200, { ok: true });
    return;
  }

  const cancelMatch = /^\/internal\/projects\/([^/]+)\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
  if (cancelMatch) {
    const projectId = decodeURIComponent(cancelMatch[1]);
    const runId = decodeURIComponent(cancelMatch[2]);
    await (opts.onCancelProjectRun ?? noopCancel)(projectId, runId);
    writeJson(res, 200, { ok: true });
    return;
  }

  writeJson(res, 404, { error: "not-found" });
}

function verifyBrokerBearer(authHeader: string | undefined): (
  | { ok: true }
  | { ok: false; statusCode: number; error: string }
) {
  const token = process.env.BROKER_TOKEN;
  if (!token) {
    return { ok: false, statusCode: 409, error: "broker-token-not-configured" };
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, statusCode: 401, error: "missing-broker-token" };
  }
  if (authHeader.slice("Bearer ".length) !== token) {
    return { ok: false, statusCode: 403, error: "invalid-broker-token" };
  }
  return { ok: true };
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function noop(): void {
}

function noopCancel(): void {
}
