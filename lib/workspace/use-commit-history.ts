"use client";
import { useCallback, useEffect, useState } from "react";
import type { CommitView } from "./commit-types";

export function useCommitHistory(projectId: string, initial: CommitView[]) {
  const [commits, setCommits] = useState<CommitView[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initial.length === 20 ? initial[19]!.id : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setCommits(initial); }, [initial, projectId]);

  const prepend = useCallback((commit: CommitView) => {
    setCommits((prev) => prev.some((c) => c.sha === commit.sha) ? prev : [commit, ...prev]);
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/commits?limit=50&cursor=${cursor}`);
      if (!res.ok) return;
      const body = await res.json() as { commits: CommitView[]; nextCursor: string | null };
      setCommits((prev) => [...prev, ...body.commits]);
      setCursor(body.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, projectId]);

  return { commits, prepend, loadMore, hasMore: !!cursor, loading };
}
