import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserCommitQueue } from "../src/user-commit-queue";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const samplePayload = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  title: "Edit foo.tsx",
  bodyMessage: "foo.tsx | +1 -0",
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  userEmail: "u@example.com",
  committedAt: new Date().toISOString(),
};

describe("createUserCommitQueue", () => {
  it("pullPending returns immediately if there is a queued payload", async () => {
    const q = createUserCommitQueue();
    q.enqueue(samplePayload);
    const res = await q.pullPending({ timeoutMs: 1_000 });
    expect(res).toEqual([samplePayload]);
  });

  it("pullPending blocks until something is enqueued, then returns", async () => {
    const q = createUserCommitQueue();
    const promise = q.pullPending({ timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(1000);
    q.enqueue(samplePayload);
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res).toEqual([samplePayload]);
  });

  it("pullPending returns [] after timeoutMs if nothing arrives", async () => {
    const q = createUserCommitQueue();
    const promise = q.pullPending({ timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_100);
    const res = await promise;
    expect(res).toEqual([]);
  });

  it("ack(sha) removes the payload so subsequent pulls do not return it", async () => {
    const q = createUserCommitQueue();
    q.enqueue(samplePayload);
    const first = await q.pullPending({ timeoutMs: 1_000 });
    expect(first).toEqual([samplePayload]);
    q.ack(samplePayload.sha);
    const secondPromise = q.pullPending({ timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await secondPromise).toEqual([]);
  });

  it("unacked payloads are returned again on the next pull", async () => {
    const q = createUserCommitQueue();
    q.enqueue(samplePayload);
    const first = await q.pullPending({ timeoutMs: 1_000 });
    expect(first).toEqual([samplePayload]);
    const second = await q.pullPending({ timeoutMs: 1_000 });
    expect(second).toEqual([samplePayload]);
  });
});
