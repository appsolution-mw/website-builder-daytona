"use client";

import { useEffect, useRef, useState, useTransition, type ComponentProps } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Clock3,
  FolderKanban,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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
    if (!name.trim()) return;
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
    const variants: Record<Project["status"], ComponentProps<typeof Badge>["variant"]> = {
      PROVISIONING: "warning",
      RUNNING: "success",
      PAUSED: "outline",
      ARCHIVED: "secondary",
      DESTROYED: "destructive",
    };
    return (
      <Badge variant={variants[status]}>
        {status === "PROVISIONING" ? "provisioning…" : status.toLowerCase()}
      </Badge>
    );
  }

  const runningCount = projects?.filter((p) => p.status === "RUNNING").length ?? 0;
  const provisioningCount = projects?.filter((p) => p.status === "PROVISIONING").length ?? 0;
  const archivedCount =
    projects?.filter((p) => p.status === "ARCHIVED" || p.status === "DESTROYED").length ?? 0;

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">
              <Boxes className="size-3.5" />
              Daytona workspace
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Projects
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Create, open, and manage isolated website builder sandboxes.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-80">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-lg font-semibold tabular-nums">{runningCount}</div>
              <div className="text-xs text-muted-foreground">running</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-lg font-semibold tabular-nums">{provisioningCount}</div>
              <div className="text-xs text-muted-foreground">building</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-lg font-semibold tabular-nums">{archivedCount}</div>
              <div className="text-xs text-muted-foreground">closed</div>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
              className="grid gap-3 sm:grid-cols-[1fr_auto]"
            >
              <label className="grid gap-2">
                <span className="text-sm font-medium text-foreground">Project name</span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Marketing site refresh"
                  autoComplete="off"
                />
              </label>
              <div className="flex items-end">
                <Button type="submit" disabled={isCreating || !name.trim()} className="w-full sm:w-auto">
                  {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
                  {isCreating ? "Provisioning…" : "Create"}
                </Button>
              </div>
            </form>
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-red-200"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Recent projects</h2>
              <p className="text-xs text-muted-foreground">Status updates refresh while containers are provisioning.</p>
            </div>
          </div>

          {projects === null ? (
            <div className="grid gap-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-md" />
                    <div className="grid gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
                <FolderKanban className="size-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-medium">No projects yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">Create a project to start a fresh workspace.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-accent/55 sm:grid-cols-[1fr_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
                      {p.status === "ARCHIVED" || p.status === "DESTROYED" ? (
                        <Archive className="size-4 text-muted-foreground" />
                      ) : (
                        <FolderKanban className="size-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {p.status === "RUNNING" ? (
                          <Button asChild variant="link" className="max-w-full text-base font-semibold text-foreground">
                            <Link href={`/project/${p.id}`} className="truncate">
                              {p.name}
                            </Link>
                          </Button>
                        ) : (
                          <span className="truncate text-base font-semibold text-muted-foreground">
                            {p.name}
                          </span>
                        )}
                        {statusBadge(p.status)}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />
                        <span>{new Date(p.lastActive).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:justify-end">
                    {p.status === "RUNNING" && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/project/${p.id}`}>Open</Link>
                      </Button>
                    )}
                    {p.status !== "DESTROYED" && (
                      <Button
                        type="button"
                        onClick={() => remove(p.id)}
                        variant="outline"
                        size="sm"
                        className="border-destructive/30 text-red-200 hover:bg-destructive/10 hover:text-red-100"
                      >
                        <Trash2 />
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
