import { WebSocketServer, type WebSocket } from "ws";
import { handleMessage } from "./handlers";

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
    socket.on("error", (err) => {
      console.error("socket error:", err);
    });
    socket.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "invalid_json",
            message: "Message was not valid JSON",
          }),
        );
        return;
      }
      const reply = handleMessage(parsed as Parameters<typeof handleMessage>[0]);
      if (reply) socket.send(JSON.stringify(reply));
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
