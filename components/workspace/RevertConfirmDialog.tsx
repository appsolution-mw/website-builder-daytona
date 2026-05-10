"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { RevertState } from "@/lib/workspace/use-revert-commit";

export function RevertConfirmDialog(props: {
  state: RevertState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { state, onCancel, onConfirm } = props;

  const open =
    state.status === "confirm" ||
    state.status === "submitting" ||
    state.status === "error";
  const submitting = state.status === "submitting";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-popover p-5 shadow-xl">
        {state.status === "confirm" || state.status === "submitting" ? (
          <ConfirmContent
            commit={state.commit}
            submitting={submitting}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        ) : null}

        {state.status === "error" ? (
          <ErrorContent
            reason={state.reason}
            message={state.message}
            onCancel={onCancel}
          />
        ) : null}
      </div>
    </div>
  );
}

function ConfirmContent(props: {
  commit: { sha: string; shortSha: string; title: string; createdAt: string;
    filesChanged: number; insertions: number; deletions: number };
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { commit, submitting, onCancel, onConfirm } = props;
  return (
    <>
      <h2 className="text-base font-semibold">
        Revert to &lsquo;{commit.title}&rsquo;?
      </h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        <div>This creates a new commit that restores the code to the state at:</div>
        <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
          <div>{commit.shortSha} · {commit.title}</div>
          <div className="mt-1">{new Date(commit.createdAt).toLocaleString()}</div>
        </div>
        <div>
          {commit.filesChanged} file{commit.filesChanged === 1 ? "" : "s"} changed{" "}
          (<span className="text-emerald-600">+{commit.insertions}</span>{" "}
          <span className="text-rose-600">−{commit.deletions}</span>)
        </div>
        <div className="text-xs">Current state stays in history.</div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting ? "Reverting…" : "Revert"}
        </Button>
      </div>
    </>
  );
}

function ErrorContent(props: {
  reason: string;
  message: string;
  onCancel: () => void;
}) {
  return (
    <>
      <h2 className="text-base font-semibold">{titleForReason(props.reason)}</h2>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        {messageForReason(props.reason, props.message)}
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={props.onCancel}>Got it</Button>
      </div>
    </>
  );
}

function titleForReason(reason: string): string {
  switch (reason) {
    case "dirty_tree": return "Cannot revert — uncommitted changes";
    case "unknown_sha": return "Commit not found";
    case "is_head": return "Already on this commit";
    case "not_idle": return "Active run";
    default: return "Revert failed";
  }
}

function messageForReason(reason: string, fallback: string): string {
  switch (reason) {
    case "dirty_tree":
      return "The working tree has uncommitted changes. Run an agent turn to commit them first, or discard them.";
    case "unknown_sha":
      return "The commit you tried to revert to is no longer in the project.";
    case "is_head":
      return "This commit is already the current state.";
    case "not_idle":
      return "An agent run is active. Cancel or wait for it to finish, then try again.";
    case "network":
      return `Network error: ${fallback}`;
    default:
      return fallback;
  }
}
