import { WebSocketServer, type WebSocket } from "ws";
import type { HostToBroker, BrokerToHost } from "@wbd/protocol";
import { handleMessage } from "./handlers";
import { runClaudeTurn, runReviewerPass, type SpawnFn } from "./claude-runner";
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
  /** Test-only: override child_process.spawn used by claude-runner. */
  __testSpawn?: SpawnFn;
}

const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "NotebookEdit", "Create"]);

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

  // Used only as a >0 threshold to decide reviewer-or-skip. fs-tracker and
  // the tool_use observer both increment on the same write; the resulting
  // inflated count is harmless for threshold use.
  let filesWrittenInTurn = 0;

  let tracker: FsTracker | undefined;
  if (enableFsTracker) {
    tracker = await createFsTracker({
      root: projectRoot,
      isAgentActive,
      onEvent: (e) => {
        if (e.source === "agent" && (e.event === "add" || e.event === "change")) {
          filesWrittenInTurn++;
        }
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
    let currentTurn:
      | { turnId: string; ctl: AbortController; reviewerCtl: AbortController }
      | null = null;

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
        const reviewerCtl = new AbortController();
        currentTurn = { turnId: msg.turnId, ctl, reviewerCtl };
        activeTurnCount++;
        filesWrittenInTurn = 0;
        const projectId = process.env.PROJECT_ID ?? "unknown";
        const turnId = msg.turnId;

        let coderDone:
          | Extract<BrokerToHost, { type: "agent.done" }>
          | null = null;
        let coderErrored = false;

        const coderOnEvent = (event: BrokerToHost) => {
          if (event.type === "agent.tool_use" && WRITE_TOOL_NAMES.has(event.tool)) {
            filesWrittenInTurn++;
          }
          if (event.type === "agent.done") {
            coderDone = event;
            return;
          }
          if (event.type === "agent.error") {
            coderErrored = true;
            send(event);
            return;
          }
          send(event);
        };

        runClaudeTurn(
          {
            projectId,
            prompt: msg.prompt,
            turnId,
            onEvent: coderOnEvent,
            signal: ctl.signal,
          },
          opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined,
        )
          .then(async () => {
            if (coderErrored) return;
            if (!coderDone) return;
            if (filesWrittenInTurn === 0) {
              send(coderDone);
              return;
            }

            send({ type: "agent.status", turnId, phase: "reviewing" });

            let reviewerDone:
              | Extract<BrokerToHost, { type: "agent.done" }>
              | null = null;

            const reviewerOnEvent = (event: BrokerToHost) => {
              if (event.type === "agent.done") {
                reviewerDone = event;
                return;
              }
              send(event);
            };

            await runReviewerPass(
              {
                projectId,
                turnId,
                onEvent: reviewerOnEvent,
                signal: reviewerCtl.signal,
              },
              opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined,
            );

            if (!coderDone) return;
            const coder = coderDone;
            const reviewer = reviewerDone ?? {
              type: "agent.done" as const,
              turnId,
              durationMs: 0,
              tokensIn: 0,
              tokensOut: 0,
              costUsd: 0,
              exitCode: 0,
            };
            send({
              type: "agent.done",
              turnId,
              durationMs: coder.durationMs + reviewer.durationMs,
              tokensIn: coder.tokensIn + reviewer.tokensIn,
              tokensOut: coder.tokensOut + reviewer.tokensOut,
              costUsd: coder.costUsd + reviewer.costUsd,
              exitCode: Math.max(coder.exitCode, reviewer.exitCode),
            });
          })
          .finally(() => {
            currentTurn = null;
            activeTurnCount = Math.max(0, activeTurnCount - 1);
          });
        return;
      }

      if (msg.type === "agent.abort") {
        if (currentTurn?.turnId === msg.turnId) {
          currentTurn.ctl.abort();
          currentTurn.reviewerCtl.abort();
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
      await new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      if (tracker) await tracker.close();
    },
  };
}
