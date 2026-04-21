/**
 * WebSocket message protocol shared between host (ws-proxy) and broker.
 * All messages are JSON; both directions use a `type` discriminator.
 */

// Messages from host → broker
export type HostToBroker =
  | { type: "ping"; nonce: string };

// Messages from broker → host
export type BrokerToHost =
  | { type: "pong"; nonce: string }
  | { type: "error"; code: string; message: string };

// Messages the browser receives from the ws-proxy (currently identical to BrokerToHost)
export type ProxyToBrowser = BrokerToHost;

// Messages the browser sends to the ws-proxy (currently identical to HostToBroker)
export type BrowserToProxy = HostToBroker;

export const PROTOCOL_VERSION = "1.0.0" as const;
