import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  performRevert,
  revertReducer,
  type RevertState,
} from "../use-revert-commit";
import type { CommitView } from "../commit-types";

const commit: CommitView = {
  id: "c1",
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  title: "add header",
  bodyMessage: "",
  filesChanged: 2,
  insertions: 5,
  deletions: 1,
  runtime: null,
  modelId: null,
  authorKind: "AGENT",
  sessionId: null,
  agentRunId: "r1",
  revertedFromSha: null,
  createdAt: new Date().toISOString(),
};

describe("revertReducer", () => {
  it("starts in idle and ignores submit/cancel from idle", () => {
    const start: RevertState = { status: "idle" };
    expect(revertReducer(start, { kind: "cancel" })).toEqual({ status: "idle" });
    expect(revertReducer(start, { kind: "submit_start" })).toEqual({ status: "idle" });
  });

  it("opens to confirm with the chosen commit", () => {
    const next = revertReducer({ status: "idle" }, { kind: "open", commit });
    expect(next).toEqual({ status: "confirm", commit });
  });

  it("transitions confirm → submitting on submit_start", () => {
    const next = revertReducer(
      { status: "confirm", commit },
      { kind: "submit_start" },
    );
    expect(next).toEqual({ status: "submitting", commit });
  });

  it("transitions submitting → success on submit_success", () => {
    const next = revertReducer(
      { status: "submitting", commit },
      { kind: "submit_success", newSha: "b".repeat(40) },
    );
    expect(next).toEqual({ status: "success", newSha: "b".repeat(40) });
  });

  it("transitions submitting → error on submit_error", () => {
    const next = revertReducer(
      { status: "submitting", commit },
      { kind: "submit_error", reason: "dirty_tree", message: "..." },
    );
    expect(next).toEqual({
      status: "error",
      commit,
      reason: "dirty_tree",
      message: "...",
    });
  });

  it("cancel from confirm/error/success returns to idle", () => {
    expect(revertReducer({ status: "confirm", commit }, { kind: "cancel" })).toEqual({ status: "idle" });
    expect(
      revertReducer(
        { status: "error", commit, reason: "network", message: "down" },
        { kind: "cancel" },
      ),
    ).toEqual({ status: "idle" });
    expect(
      revertReducer({ status: "success", newSha: "x".repeat(40) }, { kind: "cancel" }),
    ).toEqual({ status: "idle" });
  });

  it("cancel from submitting is ignored (no double-click bail-out)", () => {
    const sub: RevertState = { status: "submitting", commit };
    expect(revertReducer(sub, { kind: "cancel" })).toEqual(sub);
  });
});

describe("performRevert", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns submit_success on 201", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ newSha: "b".repeat(40), revertedFromSha: commit.sha }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const ev = await performRevert("p1", commit);
    expect(ev).toEqual({
      kind: "submit_success",
      newSha: "b".repeat(40),
    });
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/p1/commits/${commit.sha}/revert`,
      { method: "POST" },
    );
  });

  it("returns submit_error with reason from JSON body on non-201", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ reason: "dirty_tree" }), { status: 400 }),
    );
    const ev = await performRevert("p1", commit);
    expect(ev).toMatchObject({
      kind: "submit_error",
      reason: "dirty_tree",
    });
  });

  it("returns submit_error with `commit_failed` and detail when API returns 500 with detail", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ reason: "commit_failed", detail: "git boom" }),
        { status: 500 },
      ),
    );
    const ev = await performRevert("p1", commit);
    expect(ev).toMatchObject({
      kind: "submit_error",
      reason: "commit_failed",
      message: "git boom",
    });
  });

  it("falls back to status-derived message when body is unparseable", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("<html>", { status: 502 }),
    );
    const ev = await performRevert("p1", commit);
    expect(ev).toMatchObject({
      kind: "submit_error",
      reason: "commit_failed",
      message: "revert failed (502)",
    });
  });

  it("returns submit_error with reason=network when fetch throws", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("offline"),
    );
    const ev = await performRevert("p1", commit);
    expect(ev).toEqual({
      kind: "submit_error",
      reason: "network",
      message: "offline",
    });
  });
});
