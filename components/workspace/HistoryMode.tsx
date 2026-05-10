"use client";
import { useState } from "react";
import type { CommitView } from "@/lib/workspace/commit-types";
import { CommitList } from "./CommitList";
import { CommitDetail } from "./CommitDetail";

export function HistoryMode({
  projectId,
  commits,
  loadMore,
  hasMore,
  loading,
  headCommitSha,
  isProjectIdle,
  onRevertClick,
}: {
  projectId: string;
  commits: CommitView[];
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  headCommitSha?: string | null;
  isProjectIdle?: boolean;
  onRevertClick?: (commit: CommitView) => void;
}) {
  const [selectedSha, setSelectedSha] = useState<string | null>(commits[0]?.sha ?? null);
  const selected = commits.find((c) => c.sha === selectedSha) ?? null;
  const isHead = selected ? selected.sha === headCommitSha : false;
  return (
    <div className="grid h-full grid-cols-[minmax(260px,320px)_1fr] overflow-hidden border-t border-border">
      <aside className="border-r border-border bg-background">
        <CommitList
          commits={commits}
          selectedSha={selectedSha}
          onSelect={setSelectedSha}
          onLoadMore={loadMore}
          hasMore={hasMore}
          loading={loading}
        />
      </aside>
      <main className="overflow-hidden">
        <CommitDetail
          projectId={projectId}
          commit={selected}
          isHead={isHead}
          isProjectIdle={isProjectIdle}
          onRevertClick={onRevertClick}
        />
      </main>
    </div>
  );
}
