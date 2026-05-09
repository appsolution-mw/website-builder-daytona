"use client";
import { useEffect, useState } from "react";

export function CommitFileDiff({
  projectId,
  sha,
  path,
}: {
  projectId: string;
  sha: string;
  path: string;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/commits/${sha}/diff?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(`failed to load diff (${res.status})`);
          return;
        }
        const body = await res.json() as { diff: string };
        setDiff(body.diff);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [projectId, sha, path]);

  if (error) return <div className="px-3 py-2 text-xs text-rose-500">{error}</div>;
  if (diff === null) return <div className="px-3 py-2 text-xs text-muted-foreground">Loading diff…</div>;
  return (
    <pre className="overflow-x-auto whitespace-pre rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+") && !line.startsWith("+++")
          ? "text-emerald-500"
          : line.startsWith("-") && !line.startsWith("---")
          ? "text-rose-500"
          : line.startsWith("@@")
          ? "text-blue-400"
          : "text-foreground/80";
        return <div key={i} className={cls}>{line || " "}</div>;
      })}
    </pre>
  );
}
