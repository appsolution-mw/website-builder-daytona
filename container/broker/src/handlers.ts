import type { HostToBroker, BrokerToHost } from "@wbd/protocol";

/**
 * Pure function: given an incoming message, return the response (if any).
 * Returning `undefined` means "no reply".
 */
export function handleMessage(msg: HostToBroker): BrokerToHost | undefined {
  switch (msg.type) {
    case "ping":
      return { type: "pong", nonce: msg.nonce };
    default: {
      const unknown = msg as { type?: string };
      return {
        type: "error",
        code: "unknown_message_type",
        message: `Unknown message type: ${JSON.stringify(unknown?.type ?? null)}`,
      };
    }
  }
}
