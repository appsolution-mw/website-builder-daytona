import type { HostToBroker, BrokerToHost } from "@wbd/protocol";

/**
 * Pure function for stateless, one-shot message types (ping/pong).
 *
 * Stateful message types (agent.prompt, agent.abort) are handled inline in
 * ws-server.ts because they need access to the connection's turn state.
 */
export function handleMessage(msg: HostToBroker): BrokerToHost | undefined {
  switch (msg.type) {
    case "ping":
      return { type: "pong", nonce: msg.nonce };
    case "agent.prompt":
    case "agent.abort":
      // Stateful, handled elsewhere
      return undefined;
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
