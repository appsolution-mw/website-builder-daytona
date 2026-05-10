import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUserCommitForwarder } from "../src/user-commit-forwarder";

const samplePayload = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  title: "Edit foo.tsx",
  bodyMessage: "foo.tsx | +1 -0",
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  userEmail: "u@example.com",
  committedAt: "2026-05-11T12:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runUserCommitForwarder", () => {
  it("pulls from broker, posts to host, acks on success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [samplePayload] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ events: [] }), { status: 200 }),
      );

    const cancel = runUserCommitForwarder({
      sandboxId: "sb-1",
      brokerHost: "broker.local",
      brokerPort: 4000,
      brokerToken: "tk",
      hostUrl: "http://host.local",
      hmacSecret: "secret",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      pollTimeoutMs: 1_000,
    });

    // Drain microtasks to let the loop progress through pull → post → ack.
    await vi.runOnlyPendingTimersAsync();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    cancel();

    expect(fetchFn).toHaveBeenCalled();
    const calls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toContain("/internal/projects/host/git/user-commits/pull");
    expect(calls[1]).toContain("/api/internal/sandboxes/sb-1/user-commit");
    expect(calls[2]).toContain("/internal/projects/host/git/user-commits/ack");
  });

  it("does not ack when host POST fails (retries on next pull)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ events: [samplePayload] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ events: [] }), { status: 200 }),
      );

    const cancel = runUserCommitForwarder({
      sandboxId: "sb-1",
      brokerHost: "broker.local",
      brokerPort: 4000,
      brokerToken: "tk",
      hostUrl: "http://host.local",
      hmacSecret: "secret",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
      pollTimeoutMs: 1_000,
    });

    await vi.runOnlyPendingTimersAsync();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    cancel();
    const calls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("/ack"))).toBe(false);
    // The pull and host POST should have happened.
    expect(calls.some((c) => c.includes("/internal/projects/host/git/user-commits/pull"))).toBe(true);
    expect(calls.some((c) => c.includes("/api/internal/sandboxes/sb-1/user-commit"))).toBe(true);
  });
});
