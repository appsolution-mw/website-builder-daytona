"use client";

import { useCallback, useReducer } from "react";
import type { CommitView } from "./commit-types";

export type RevertApiReason =
  | "dirty_tree"
  | "unknown_sha"
  | "is_head"
  | "not_idle"
  | "commit_failed"
  | "network";

export type RevertState =
  | { status: "idle" }
  | { status: "confirm"; commit: CommitView }
  | { status: "submitting"; commit: CommitView }
  | {
      status: "error";
      commit: CommitView;
      reason: RevertApiReason;
      message: string;
    }
  | { status: "success"; newSha: string };

export type RevertEvent =
  | { kind: "open"; commit: CommitView }
  | { kind: "cancel" }
  | { kind: "submit_start" }
  | { kind: "submit_success"; newSha: string }
  | { kind: "submit_error"; reason: RevertApiReason; message: string };

export function revertReducer(state: RevertState, event: RevertEvent): RevertState {
  switch (event.kind) {
    case "open":
      return { status: "confirm", commit: event.commit };
    case "cancel":
      if (state.status === "submitting") return state;
      return { status: "idle" };
    case "submit_start":
      if (state.status !== "confirm") return state;
      return { status: "submitting", commit: state.commit };
    case "submit_success":
      if (state.status !== "submitting") return state;
      return { status: "success", newSha: event.newSha };
    case "submit_error":
      if (state.status !== "submitting") return state;
      return {
        status: "error",
        commit: state.commit,
        reason: event.reason,
        message: event.message,
      };
  }
}

export async function performRevert(
  projectId: string,
  commit: CommitView,
): Promise<RevertEvent> {
  let res: Response;
  try {
    res = await fetch(
      `/api/projects/${projectId}/commits/${commit.sha}/revert`,
      { method: "POST" },
    );
  } catch (error) {
    return {
      kind: "submit_error",
      reason: "network",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (res.status === 201) {
    const body = (await res.json()) as { newSha: string };
    return { kind: "submit_success", newSha: body.newSha };
  }

  let reason: RevertApiReason = "commit_failed";
  let message = `revert failed (${res.status})`;
  try {
    const body = (await res.json()) as { reason?: RevertApiReason; detail?: string };
    if (body.reason) reason = body.reason;
    if (body.detail) message = body.detail;
  } catch {
    // body parse failed; keep status-derived message
  }
  return { kind: "submit_error", reason, message };
}

export interface UseRevertCommitResult {
  state: RevertState;
  open: (commit: CommitView) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export function useRevertCommit(projectId: string): UseRevertCommitResult {
  const [state, dispatch] = useReducer(revertReducer, { status: "idle" });

  const open = useCallback((commit: CommitView) => {
    dispatch({ kind: "open", commit });
  }, []);

  const cancel = useCallback(() => {
    dispatch({ kind: "cancel" });
  }, []);

  const confirm = useCallback(async () => {
    if (state.status !== "confirm") return;
    const commit = state.commit;
    dispatch({ kind: "submit_start" });
    const event = await performRevert(projectId, commit);
    dispatch(event);
  }, [projectId, state]);

  return { state, open, cancel, confirm };
}
