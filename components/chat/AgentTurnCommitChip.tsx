"use client";

import type { CommitView } from "@/lib/workspace/commit-types";

export function AgentTurnCommitChip(props: {
  commit: CommitView;
  isHead: boolean;
  isProjectIdle: boolean;
  onRevertClick: (commit: CommitView) => void;
}) {
  const { commit, isHead, isProjectIdle, onRevertClick } = props;
  const isRollback = commit.authorKind === "ROLLBACK";
  const showRevert = !isHead && !isRollback;

  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
      <span className="text-emerald-600">✓</span>
      <span className="font-mono">{commit.shortSha}</span>
      <span>·</span>
      <span>{commit.filesChanged} file{commit.filesChanged === 1 ? "" : "s"}</span>
      <span className="text-emerald-600">+{commit.insertions}</span>
      <span className="text-rose-600">−{commit.deletions}</span>
      {showRevert && (
        <button
          type="button"
          disabled={!isProjectIdle}
          onClick={() => onRevertClick(commit)}
          title={isProjectIdle ? "Revert to this commit" : "Active run — abort or wait"}
          className="ml-1 rounded p-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Revert to this commit"
        >
          ↶
        </button>
      )}
    </div>
  );
}
