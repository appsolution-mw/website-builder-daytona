import { describe, it, expect } from "vitest";
import { handleMessage } from "../src/handlers";
import type { HostToBroker, BrokerToHost } from "@wbd/protocol";

describe("broker handlers", () => {
  it("responds to ping with pong carrying the same nonce", () => {
    const input: HostToBroker = { type: "ping", nonce: "abc-123" };
    const output = handleMessage(input);
    expect(output).toEqual<BrokerToHost>({ type: "pong", nonce: "abc-123" });
  });

  it("returns an error for unknown message types", () => {
    // @ts-expect-error — intentional invalid input
    const output = handleMessage({ type: "garbage" });
    expect(output).toEqual<BrokerToHost>({
      type: "error",
      code: "unknown_message_type",
      message: 'Unknown message type: "garbage"',
    });
  });
});
