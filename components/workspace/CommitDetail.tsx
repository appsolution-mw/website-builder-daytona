"use client";
import { useEffect, useState } from "react";
import { dbRuntimeToProtocol, runtimeLabel } from "@/lib/agents/runtime";
import type { CommitFileEntry, CommitView } from "@/lib/workspace/commit-types";
import { CommitFileDiff } from "./CommitFileDiff";

export function CommitDetail({
  projectId,
  commit,
  isHead = false,
  isProjectIdle = true,
  onRevertClick,
}: {
  projectId: string;
  commit: CommitView | null;
  isHead?: boolean;
  isProjectIdle?: boolean;
  onRevertClick?: (commit: CommitView) => void;
}) {
  const [files, setFiles] = useState<CommitFileEntry[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [trackedSha, setTrackedSha] = useState<string | null>(commit?.sha ?? null);
  if (trackedSha !== (commit?.sha ?? null)) {
    setTrackedSha(commit?.sha ?? null);
    setFiles([]);
    setOpenPath(null);
    setError(null);
  }

  useEffect(() => {
    if (!commit) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/commits/${commit.sha}/files`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setError(`failed to load files (${res.status})`); return; }
        const body = await res.json() as { files: CommitFileEntry[] };
        setFiles(body.files);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [projectId, commit]);

  if (!commit) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a commit to inspect.</div>;
  }

  const isRollback = commit.authorKind === "ROLLBACK";
  const isUser = commit.authorKind === "USER";
  const showRevert = !isHead && !isRollback && Boolean(onRevertClick);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-start gap-3 border-b border-border pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            {isRollback ? "↶ " : isUser ? "✎ " : ""}{commit.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{commit.shortSha}</span>
            <span>·</span>
            <span>{isUser ? (commit.userEmail ?? "user") : "launchnode-agent"}</span>
            <span>·</span>
            <span>{new Date(commit.createdAt).toLocaleString()}</span>
            {commit.runtime && (<><span>·</span><span>{runtimeLabel(dbRuntimeToProtocol(commit.runtime))}{commit.modelId ? ` · ${commit.modelId}` : ""}</span></>)}
            {isRollback && commit.revertedFromSha && (
              <>
                <span>·</span>
                <span>reverted from <span className="font-mono">{commit.revertedFromSha.slice(0, 7)}</span></span>
              </>
            )}
          </div>
          {commit.bodyMessage && (
            <pre className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
              {commit.bodyMessage}
            </pre>
          )}
        </div>
        {showRevert && (
          <button
            type="button"
            disabled={!isProjectIdle}
            onClick={() => onRevertClick?.(commit)}
            title={isProjectIdle ? "Revert to this commit" : "Active run — abort or wait"}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↶ Revert
          </button>
        )}
      </div>

      {error && <div className="mb-3 text-xs text-rose-500">{error}</div>}

      <ul className="flex flex-col">
        {files.map((f) => {
          const isOpen = f.path === openPath;
          return (
            <li key={f.path} className="border-b border-border">
              <button
                type="button"
                onClick={() => setOpenPath(isOpen ? null : f.path)}
                className="flex w-full items-center gap-3 px-2 py-2 text-left text-sm hover:bg-accent/50"
              >
                <span className="truncate font-mono text-xs">{f.path}</span>
                <span className="ml-auto text-xs text-emerald-500">+{f.insertions}</span>
                <span className="text-xs text-rose-500">−{f.deletions}</span>
              </button>
              {isOpen && <div className="px-2 pb-3"><CommitFileDiff projectId={projectId} sha={commit.sha} path={f.path} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
