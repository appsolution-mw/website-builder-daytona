import { WebSocketServer, type WebSocket } from "ws";
import type { HostToBroker, BrokerToHost } from "@wbd/protocol";
import { handleMessage } from "./handlers";
import { runClaudeTurn } from "./claude-runner";
import { createFsTracker, type FsTracker } from "./fs-tracker";
import {
  handleFileList,
  handleFileRead,
  handleFileWrite,
} from "./fs-handlers";

export interface BrokerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface StartBrokerOptions {
  port: number;
  projectRoot?: string;
  enableFsTracker?: boolean;
}

export async function startBroker(opts: StartBrokerOptions): Promise<BrokerHandle> {
  const projectRoot = opts.projectRoot ?? "/workspace/project";
  const enableFsTracker = opts.enableFsTracker ?? true;

  const wss = new WebSocketServer({ port: opts.port });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("ws server did not bind to a numeric port");
  }

  let activeTurnCount = 0;
  const isAgentActive = () => activeTurnCount > 0;
  const isLocked = () => activeTurnCount > 0;

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
      onEvent: (e) =>
        broadcast({
          type: "file.changed",
          path: e.path,
          event: e.event,
          source: e.source,
        }),
    });
  }

  wss.on("connection", (socket: WebSocket) => {
    let currentTurn: { turnId: string; ctl: AbortController } | null = null;

    const send = (obj: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    };

    socket.on("error", (err) => {
      console.error("socket error:", err);
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
        if (currentTurn) {
          send({
            type: "agent.error",
            turnId: msg.turnId,
            message: `another turn (${currentTurn.turnId}) is already running`,
          });
          return;
        }
        const ctl = new AbortController();
        currentTurn = { turnId: msg.turnId, ctl };
        activeTurnCount++;
        const projectId = process.env.PROJECT_ID ?? "unknown";
        runClaudeTurn({
          projectId,
          prompt: msg.prompt,
          turnId: msg.turnId,
          onEvent: (event) => send(event),
          signal: ctl.signal,
        }).finally(() => {
          currentTurn = null;
          activeTurnCount = Math.max(0, activeTurnCount - 1);
        });
        return;
      }

      if (msg.type === "agent.abort") {
        if (currentTurn?.turnId === msg.turnId) {
          currentTurn.ctl.abort();
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

      const reply = handleMessage(msg);
      if (reply) send(reply);
    });
  });

  return {
    port: address.port,
    close: async () => {
      if (tracker) await tracker.close();
      await new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
