import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchBrokerReadiness } from "../src/broker-ready.js";

describe("watchBrokerReadiness", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("posts brokerPort + previewPort in the body when probe succeeds", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/health")) return new Response(null, { status: 200 });
      return new Response(null, { status: 204 });
    });

    watchBrokerReadiness({
      sandboxId: "sb-1",
      brokerHost: "127.0.0.1",
      brokerPort: 38881,
      previewPort: 38882,
      hostUrl: "http://host:3000",
      hmacSecret: "s".repeat(32),
      intervalMs: 50,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await vi.advanceTimersByTimeAsync(0);
    // Probe + report fire on microtasks; let them settle.
    await vi.runOnlyPendingTimersAsync();
    // Drain pending microtasks.
    for (let i = 0; i < 3; i += 1) await Promise.resolve();

    const callbackCall = fetchMock.mock.calls.find(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.includes("/api/internal/sandboxes/sb-1/broker-ready");
    });
    expect(callbackCall).toBeDefined();
    const body = JSON.parse((callbackCall![1] as RequestInit).body as string);
    expect(body).toEqual({ brokerPort: 38881, previewPort: 38882 });
  });

  it("omits previewPort when not provided", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/health")) return new Response(null, { status: 200 });
      return new Response(null, { status: 204 });
    });

    watchBrokerReadiness({
      sandboxId: "sb-2",
      brokerHost: "127.0.0.1",
      brokerPort: 30077,
      hostUrl: "http://host:3000",
      hmacSecret: "s".repeat(32),
      intervalMs: 50,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.runOnlyPendingTimersAsync();
    for (let i = 0; i < 3; i += 1) await Promise.resolve();

    const callbackCall = fetchMock.mock.calls.find(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.includes("/api/internal/sandboxes/sb-2/broker-ready");
    });
    expect(callbackCall).toBeDefined();
    const body = JSON.parse((callbackCall![1] as RequestInit).body as string);
    expect(body).toEqual({ brokerPort: 30077 });
    expect(body.previewPort).toBeUndefined();
  });
});
