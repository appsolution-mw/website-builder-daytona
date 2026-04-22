import { WebSocketServer, type WebSocket } from "ws";
import type { HostToBroker } from "@wbd/protocol";
import { handleMessage } from "./handlers";
import { runClaudeTurn } from "./claude-runner";

export interface BrokerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface StartBrokerOptions {
  /** Port to listen on. Use 0 to let the OS pick an available port. */
  port: number;
}

export async function startBroker(opts: StartBrokerOptions): Promise<BrokerHandle> {
  const wss = new WebSocketServer({ port: opts.port });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  const address = wss.address();
  if (!address || typeof address === "string") {
    throw new Error("ws server did not bind to a numeric port");
  }

  wss.on("connection", (socket: WebSocket) => {
    // Per-connection state
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

      // Stateful branches
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
        const projectId = process.env.PROJECT_ID ?? "unknown";
        runClaudeTurn({
          projectId,
          prompt: msg.prompt,
          turnId: msg.turnId,
          onEvent: (event) => send(event),
          signal: ctl.signal,
        }).finally(() => {
          currentTurn = null;
        });
        return;
      }

      if (msg.type === "agent.abort") {
        if (currentTurn?.turnId === msg.turnId) {
          currentTurn.ctl.abort();
        }
        return;
      }

      // Stateless: defer to pure handler
      const reply = handleMessage(msg);
      if (reply) send(reply);
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
