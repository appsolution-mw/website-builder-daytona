import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat, type HeartbeatBody } from "../src/heartbeat.js";

describe("heartbeat", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("posts on first interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const stop = startHeartbeat({
      hostUrl: "http://host:3000",
      workerId: "w1",
      hmacSecret: "s".repeat(32),
      intervalMs: 1000,
      fetch: fetchMock,
      sample: () => ({ runningSandboxes: 2, dockerVersion: "x", uptime: 5 }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host:3000/api/internal/workers/w1/heartbeat");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as HeartbeatBody;
    expect(body.runningSandboxes).toBe(2);
    stop();
  });

  it("includes HMAC headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const stop = startHeartbeat({
      hostUrl: "http://host:3000",
      workerId: "w1",
      hmacSecret: "s".repeat(32),
      intervalMs: 1000,
      fetch: fetchMock,
      sample: () => ({ runningSandboxes: 0, dockerVersion: "x", uptime: 0 }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    const [, init] = fetchMock.mock.calls[0];
    const h = init?.headers as Record<string, string>;
    expect(h["x-timestamp"]).toBeTruthy();
    expect(h["x-signature"]).toMatch(/^[a-f0-9]{64}$/);
    stop();
  });

  it("does not throw on non-2xx; logs and continues", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const stop = startHeartbeat({
      hostUrl: "http://host:3000",
      workerId: "w1",
      hmacSecret: "s".repeat(32),
      intervalMs: 1000,
      fetch: fetchMock,
      sample: () => ({ runningSandboxes: 0, dockerVersion: "x", uptime: 0 }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not throw on network errors; logs and continues", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const stop = startHeartbeat({
      hostUrl: "http://host:3000",
      workerId: "w1",
      hmacSecret: "s".repeat(32),
      intervalMs: 1000,
      fetch: fetchMock,
      sample: () => ({ runningSandboxes: 0, dockerVersion: "x", uptime: 0 }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stop() cancels future ticks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const stop = startHeartbeat({
      hostUrl: "http://host:3000",
      workerId: "w1",
      hmacSecret: "s".repeat(32),
      intervalMs: 1000,
      fetch: fetchMock,
      sample: () => ({ runningSandboxes: 0, dockerVersion: "x", uptime: 0 }),
    });
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
