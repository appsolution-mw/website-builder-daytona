"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  lastActive: string;
  brokerUrl: string | null;
  previewUrl: string | null;
};

const POLL_INTERVAL_MS = 3_000;

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [isCreating, startCreate] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
    } catch (err) {
      setProjects([]);
      setError(err instanceof Error ? err.message : "failed to load");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { projects: Project[] };
        if (!cancelled) setProjects(data.projects);
      } catch (err) {
        if (cancelled) return;
        setProjects([]);
        setError(err instanceof Error ? err.message : "failed to load");
      }
    }
    loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while any project is PROVISIONING
  useEffect(() => {
    const hasProvisioning = projects?.some((p) => p.status === "PROVISIONING");
    if (hasProvisioning && pollRef.current === null) {
      pollRef.current = window.setInterval(() => refresh(), POLL_INTERVAL_MS);
    } else if (!hasProvisioning && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [projects]);

  function create() {
    setError(null);
    startCreate(async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "failed");
        await refresh();
        return;
      }
      setName("");
      await refresh();
    });
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and destroy its container?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    await refresh();
  }

  function statusBadge(status: Project["status"]) {
    const styles: Record<Project["status"], string> = {
      PROVISIONING: "bg-yellow-100 text-yellow-800",
      RUNNING: "bg-green-100 text-green-800",
      PAUSED: "bg-gray-100 text-gray-600",
      ARCHIVED: "bg-gray-100 text-gray-500",
      DESTROYED: "bg-red-50 text-red-700",
    };
    return (
      <span className={`rounded px-2 py-0.5 text-xs ${styles[status]}`}>
        {status === "PROVISIONING" ? "provisioning…" : status.toLowerCase()}
      </span>
    );
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
          disabled={isCreating || !name.trim()}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {isCreating ? "Provisioning…" : "Create"}
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
            <li key={p.id} className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                {p.status === "RUNNING" ? (
                  <Link href={`/project/${p.id}`} className="font-medium underline">
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-600">{p.name}</span>
                )}
                {statusBadge(p.status)}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{new Date(p.lastActive).toLocaleString()}</span>
                {p.status !== "DESTROYED" && (
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
