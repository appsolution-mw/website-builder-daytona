"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";

type Project = {
  id: string;
  name: string;
  status: string;
  lastActive: string;
};

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch (err) {
      setProjects([]);
      setError(err instanceof Error ? err.message : "failed to load projects");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "failed");
        return;
      }
      setName("");
      await refresh();
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          className="flex-1 rounded border border-gray-300 px-3 py-2"
        />
        <button
          onClick={create}
          disabled={isPending || !name.trim()}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {projects === null ? (
        <p className="text-gray-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-gray-500">No projects yet.</p>
      ) : (
        <ul className="divide-y rounded border border-gray-200">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between p-3">
              <div>
                <Link href={`/project/${p.id}`} className="font-medium underline">
                  {p.name}
                </Link>
                <div className="text-xs text-gray-500">{p.status}</div>
              </div>
              <div className="text-xs text-gray-400">
                {new Date(p.lastActive).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
