import { WebSocketServer, type WebSocket } from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type {
  AgentUsageDetails,
  AgentUsageEvent,
  AgentUsageLabel,
  HostToBroker,
  BrokerToHost,
  PromptImageAttachment,
} from "@wbd/protocol";
import { handleMessage } from "./handlers";
import type { SpawnFn } from "./claude-runner";
import { createAgentProvider } from "./agent-provider-factory";
import { agentRuntimeFromEnv } from "./agent-provider";
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
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const UPLOADS_DIR = ".agent-artifacts/chat-uploads";
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const SIMPLE_CHANGE_SUMMARY = "Fertig — ich habe die Änderung umgesetzt.";

function safeFileName(name: string, mimeType: string, index: number): string {
  const fallbackExt = IMAGE_EXTENSIONS[mimeType] ?? ".png";
  const rawBase = basename(name || `image-${index}${fallbackExt}`);
  const originalExt = extname(rawBase);
  const ext = originalExt || fallbackExt;
  const stem = (originalExt ? rawBase.slice(0, -originalExt.length) : rawBase)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${index}-${stem || "image"}${ext.toLowerCase()}`;
}

function attachmentError(message: string, turnId: string): BrokerToHost {
  return { type: "agent.error", turnId, message };
}

function logTokenUsage(
  label: AgentUsageLabel,
  projectId: string,
  done: Extract<BrokerToHost, { type: "agent.done" }>,
) {
  const usage = done.usage;
  console.log(
    [
      "[usage]",
      `label=${label}`,
      `project=${projectId}`,
      `turn=${done.turnId}`,
      `input_tokens=${done.tokensIn}`,
      `output_tokens=${done.tokensOut}`,
      `cache_creation_input_tokens=${usage?.cacheCreationInputTokens ?? 0}`,
      `cache_read_input_tokens=${usage?.cacheReadInputTokens ?? 0}`,
      `total_tokens=${usage?.totalTokens ?? done.tokensIn + done.tokensOut}`,
      `web_search_requests=${usage?.webSearchRequests ?? 0}`,
      `web_fetch_requests=${usage?.webFetchRequests ?? 0}`,
      `cost_usd=${done.costUsd.toFixed(6)}`,
      `duration_ms=${done.durationMs}`,
      `exit_code=${done.exitCode}`,
    ].join(" "),
  );
}

function toUsageEvent(
  label: AgentUsageLabel,
  done: Extract<BrokerToHost, { type: "agent.done" }>,
): AgentUsageEvent {
  return {
    type: "agent.usage",
    turnId: done.turnId,
    label,
    durationMs: done.durationMs,
    tokensIn: done.tokensIn,
    tokensOut: done.tokensOut,
    costUsd: done.costUsd,
    exitCode: done.exitCode,
    ...(done.usage ? { usage: done.usage } : {}),
  };
}

function mergeUsageDetails(
  coder: Extract<BrokerToHost, { type: "agent.done" }>,
  reviewer: Extract<BrokerToHost, { type: "agent.done" }>,
): AgentUsageDetails | undefined {
  if (!coder.usage && !reviewer.usage) return undefined;
  return {
    inputTokens: coder.tokensIn + reviewer.tokensIn,
    outputTokens: coder.tokensOut + reviewer.tokensOut,
    cacheCreationInputTokens:
      (coder.usage?.cacheCreationInputTokens ?? 0) +
      (reviewer.usage?.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens:
      (coder.usage?.cacheReadInputTokens ?? 0) +
      (reviewer.usage?.cacheReadInputTokens ?? 0),
    totalTokens:
      (coder.usage?.totalTokens ?? coder.tokensIn + coder.tokensOut) +
      (reviewer.usage?.totalTokens ?? reviewer.tokensIn + reviewer.tokensOut),
    webSearchRequests:
      (coder.usage?.webSearchRequests ?? 0) + (reviewer.usage?.webSearchRequests ?? 0),
    webFetchRequests:
      (coder.usage?.webFetchRequests ?? 0) + (reviewer.usage?.webFetchRequests ?? 0),
    rawUsage: {
      coder: coder.usage?.rawUsage ?? null,
      reviewer: reviewer.usage?.rawUsage ?? null,
    },
    modelUsage: {
      coder: coder.usage?.modelUsage ?? null,
      reviewer: reviewer.usage?.modelUsage ?? null,
    },
  };
}

async function savePromptAttachments(args: {
  projectRoot: string;
  turnId: string;
  attachments?: PromptImageAttachment[];
}): Promise<{ promptLines: string[]; error?: BrokerToHost }> {
  const attachments = args.attachments ?? [];
  if (attachments.length === 0) return { promptLines: [] };
  if (attachments.length > MAX_ATTACHMENTS) {
    return {
      promptLines: [],
      error: attachmentError(`Too many images attached. Maximum is ${MAX_ATTACHMENTS}.`, args.turnId),
    };
  }

  const uploadDir = resolve(args.projectRoot, UPLOADS_DIR, args.turnId);
  await mkdir(uploadDir, { recursive: true });

  const promptLines = ["", "Attached image files:"];
  let totalBytes = 0;

  for (const [idx, attachment] of attachments.entries()) {
    if (!IMAGE_EXTENSIONS[attachment.mimeType]) {
      return {
        promptLines: [],
        error: attachmentError(`Unsupported image type: ${attachment.mimeType || "unknown"}.`, args.turnId),
      };
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(attachment.dataBase64, "base64");
    } catch {
      return {
        promptLines: [],
        error: attachmentError(`Image ${attachment.name || idx + 1} could not be decoded.`, args.turnId),
      };
    }
    if (buffer.length === 0) {
      return {
        promptLines: [],
        error: attachmentError(`Image ${attachment.name || idx + 1} is empty.`, args.turnId),
      };
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return {
        promptLines: [],
        error: attachmentError(`Image ${attachment.name || idx + 1} is larger than 8 MB.`, args.turnId),
      };
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        promptLines: [],
        error: attachmentError("Attached images are larger than 20 MB total.", args.turnId),
      };
    }

    const fileName = safeFileName(attachment.name, attachment.mimeType, idx + 1);
    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, buffer);
    promptLines.push(`${idx + 1}. ${filePath}`);
  }

  promptLines.push("", "Use these image paths as visual context for the user's request.");
  return { promptLines };
}

export async function startBroker(opts: StartBrokerOptions): Promise<BrokerHandle> {
  const projectRoot = opts.projectRoot ?? "/workspace/project";
  const enableFsTracker = opts.enableFsTracker ?? true;
  console.log(`[broker] default agent runtime=${agentRuntimeFromEnv()}`);

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
        if (!msg.providerSessionId) {
          send({
            type: "agent.error",
            turnId: msg.turnId,
            message: "missing providerSessionId",
          });
          return;
        }

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
        const agentProvider = createAgentProvider({
          runtime: msg.runtime,
          __testSpawn: opts.__testSpawn,
        });

        let coderDone:
          | Extract<BrokerToHost, { type: "agent.done" }>
          | null = null;
        let coderErrored = false;
        const coderChunks: Extract<BrokerToHost, { type: "agent.chunk" }>[] = [];

        const coderOnEvent = (event: BrokerToHost) => {
          if (event.type === "agent.tool_use" && WRITE_TOOL_NAMES.has(event.tool)) {
            filesWrittenInTurn++;
          }
          if (event.type === "agent.chunk") {
            coderChunks.push(event);
            return;
          }
          if (event.type === "agent.done") {
            coderDone = event;
            logTokenUsage("coder", projectId, event);
            send(toUsageEvent("coder", event));
            return;
          }
          if (event.type === "agent.error") {
            coderErrored = true;
            send(event);
            return;
          }
          send(event);
        };

        (async () => {
          send({
            type: "agent.session",
            turnId,
            runtime: msg.runtime,
            providerSessionId: msg.providerSessionId,
            ...(msg.modelId ? { modelId: msg.modelId } : {}),
          });
          const attachmentResult = await savePromptAttachments({
            projectRoot,
            turnId,
            attachments: msg.attachments,
          });
          if (attachmentResult.error) {
            send(attachmentResult.error);
            coderErrored = true;
            return;
          }

          const prompt = attachmentResult.promptLines.length > 0
            ? [msg.prompt, ...attachmentResult.promptLines].join("\n")
            : msg.prompt;

          await agentProvider.runTurn(
            {
              projectId,
              sessionId: msg.providerSessionId,
              resumeSession: msg.resumeSession,
              prompt,
              turnId,
              projectRoot,
              modelId: msg.modelId,
              onEvent: coderOnEvent,
              signal: ctl.signal,
            },
          );
        })()
          .then(async () => {
            if (coderErrored) return;
            if (!coderDone) return;
            if (filesWrittenInTurn === 0) {
              logTokenUsage("turn", projectId, coderDone);
              send(toUsageEvent("turn", coderDone));
              for (const chunk of coderChunks) send(chunk);
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
                logTokenUsage("reviewer", projectId, event);
                send(toUsageEvent("reviewer", event));
                return;
              }
              if (event.type === "agent.chunk") {
                return;
              }
              send(event);
            };

            await agentProvider.runReview?.({
              projectId,
              turnId,
              onEvent: reviewerOnEvent,
              signal: reviewerCtl.signal,
            });

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
            const done = {
              type: "agent.done",
              turnId,
              durationMs: coder.durationMs + reviewer.durationMs,
              tokensIn: coder.tokensIn + reviewer.tokensIn,
              tokensOut: coder.tokensOut + reviewer.tokensOut,
              costUsd: coder.costUsd + reviewer.costUsd,
              exitCode: Math.max(coder.exitCode, reviewer.exitCode),
              ...(mergeUsageDetails(coder, reviewer)
                ? { usage: mergeUsageDetails(coder, reviewer) }
                : {}),
            } satisfies Extract<BrokerToHost, { type: "agent.done" }>;
            logTokenUsage("turn", projectId, done);
            send(toUsageEvent("turn", done));
            send({ type: "agent.chunk", turnId, delta: SIMPLE_CHANGE_SUMMARY });
            send(done);
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            send({ type: "agent.error", turnId, message: `image attachment failed: ${message}` });
          })
          .finally(() => {
            currentTurn = null;
            activeTurnCount = Math.max(0, activeTurnCount - 1);
          });
        return;
      }

      if (msg.type === "agent.abort") {
        console.log(
          `[broker] agent.abort received turn=${msg.turnId} currentTurn=${currentTurn?.turnId ?? "null"}`,
        );
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
