/**
 * WebSocket message protocol shared between host (ws-proxy) and broker.
 * All messages are JSON; both directions use a `type` discriminator.
 */

// Messages from host → broker
export type HostToBroker =
  | { type: "ping"; nonce: string }
  | { type: "agent.prompt"; prompt: string; turnId: string }
  | { type: "agent.abort"; turnId: string };

// Messages from broker → host
export type BrokerToHost =
  | { type: "pong"; nonce: string }
  | { type: "error"; code: string; message: string }
  | {
      type: "agent.status";
      turnId: string;
      phase: "starting" | "thinking" | "tool_use" | "writing_file" | "done";
      detail?: string;
    }
  | { type: "agent.chunk"; turnId: string; delta: string }
  | { type: "agent.tool_use"; turnId: string; tool: string; input: unknown }
  | {
      type: "agent.done";
      turnId: string;
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      exitCode: number;
    }
  | { type: "agent.error"; turnId: string; message: string };

// Messages the browser receives from the ws-proxy (currently identical to BrokerToHost)
export type ProxyToBrowser = BrokerToHost;

// Messages the browser sends to the ws-proxy (currently identical to HostToBroker)
export type BrowserToProxy = HostToBroker;

export const PROTOCOL_VERSION = "1.2.0" as const;
