"use client";
import { GitCommit } from "lucide-react";
import type { CommitView } from "@/lib/workspace/commit-types";

export function CommitList({
  commits,
  selectedSha,
  onSelect,
  onLoadMore,
  hasMore,
  loading,
}: {
  commits: CommitView[];
  selectedSha: string | null;
  onSelect: (sha: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}) {
  if (commits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
        <GitCommit className="mb-2 size-5 opacity-50" />
        No commits yet. Send a prompt to make the first one.
      </div>
    );
  }
  return (
    <ul className="flex h-full flex-col overflow-y-auto">
      {commits.map((c) => {
        const isSelected = c.sha === selectedSha;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.sha)}
              className={`flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left text-sm transition ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{c.shortSha}</span>
                <span className="truncate font-medium">
                  {c.authorKind === "ROLLBACK" ? "↶ " : ""}{c.title}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{c.filesChanged} file{c.filesChanged === 1 ? "" : "s"}</span>
                <span className="text-emerald-500">+{c.insertions}</span>
                <span className="text-rose-500">−{c.deletions}</span>
                <span className="ml-auto">{relativeTime(c.createdAt)}</span>
              </div>
            </button>
          </li>
        );
      })}
      {hasMore && (
        <li className="px-3 py-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="w-full rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </li>
      )}
    </ul>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}
