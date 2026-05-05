"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ComponentProps,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Boxes,
  Clock3,
  FolderKanban,
  GitBranch,
  LogOut,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { localHttpUrlForBrowserPort } from "@/lib/network/local-url";

type Project = {
  id: string;
  name: string;
  status: "PROVISIONING" | "RUNNING" | "PAUSED" | "ARCHIVED" | "DESTROYED";
  lastActive: string;
  brokerUrl: string | null;
  previewUrl: string | null;
  sourceType: "TEMPLATE" | "GITHUB";
  githubOwner: string | null;
  githubRepo: string | null;
  githubBaseBranch: string | null;
};

type OrphanSandbox = {
  sandboxId: string;
  containerId?: string;
  brokerPort?: number;
  previewPort?: number;
  status: "spawning" | "running" | "stopped" | "gone";
};

type GitHubInstallation = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
};

type GitHubRepository = {
  id: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

type GitHubBranch = {
  name: string;
  sha: string;
};

const POLL_INTERVAL_MS = 3_000;

function subscribeBrowserHostname(): () => void {
  return () => {};
}

function getBrowserHostnameSnapshot(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

function getServerBrowserHostnameSnapshot(): undefined {
  return undefined;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [orphanSandboxes, setOrphanSandboxes] = useState<OrphanSandbox[] | null>(null);
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"template" | "github">("template");
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installations, setInstallations] = useState<GitHubInstallation[] | null>(null);
  const [selectedInstallationId, setSelectedInstallationId] = useState("");
  const [repositories, setRepositories] = useState<GitHubRepository[] | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [isCreating, startCreate] = useTransition();
  const [isRefreshingOrphans, startRefreshOrphans] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [orphanError, setOrphanError] = useState<string | null>(null);
  const [removingOrphanId, setRemovingOrphanId] = useState<string | null>(null);
  const browserHostname = useSyncExternalStore(
    subscribeBrowserHostname,
    getBrowserHostnameSnapshot,
    getServerBrowserHostnameSnapshot,
  );
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

  async function refreshOrphans() {
    try {
      const res = await fetch("/api/admin/orphan-sandboxes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { sandboxes: OrphanSandbox[] };
      setOrphanSandboxes(data.sandboxes);
      setOrphanError(null);
    } catch (err) {
      setOrphanSandboxes([]);
      setOrphanError(err instanceof Error ? err.message : "failed to load orphan sandboxes");
    }
  }

  async function refreshGitHubInstallations() {
    try {
      const res = await fetch("/api/github/installations", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        installUrl: string | null;
        installations: GitHubInstallation[];
      };
      setInstallUrl(data.installUrl);
      setInstallations(data.installations);
      setGithubError(null);
      if (!selectedInstallationId && data.installations[0]) {
        setSelectedInstallationId(data.installations[0].id);
      }
    } catch (err) {
      setInstallations([]);
      setGithubError(err instanceof Error ? err.message : "failed to load GitHub installations");
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

  useEffect(() => {
    let cancelled = false;
    async function loadInitialOrphans() {
      try {
        const res = await fetch("/api/admin/orphan-sandboxes", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { sandboxes: OrphanSandbox[] };
        if (!cancelled) {
          setOrphanSandboxes(data.sandboxes);
          setOrphanError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setOrphanSandboxes([]);
        setOrphanError(err instanceof Error ? err.message : "failed to load orphan sandboxes");
      }
    }
    loadInitialOrphans();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialGitHubInstallations() {
      try {
        const res = await fetch("/api/github/installations", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          installUrl: string | null;
          installations: GitHubInstallation[];
        };
        if (!cancelled) {
          setInstallUrl(data.installUrl);
          setInstallations(data.installations);
          setGithubError(null);
          if (data.installations[0]) {
            setSelectedInstallationId(data.installations[0].id);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setInstallations([]);
        setGithubError(err instanceof Error ? err.message : "failed to load GitHub installations");
      }
    }
    void loadInitialGitHubInstallations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedInstallationId) {
      return;
    }

    let cancelled = false;
    async function loadRepositories() {
      setIsLoadingRepositories(true);
      setRepositories(null);
      setGithubError(null);
      try {
        const res = await fetch(
          `/api/github/installations/${selectedInstallationId}/repositories`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { repositories: GitHubRepository[] };
        if (cancelled) return;
        setRepositories(data.repositories);
        const nextRepository = data.repositories.find((repo) => repo.id === selectedRepositoryId) ??
          data.repositories[0];
        setSelectedRepositoryId(nextRepository?.id ?? "");
        setSelectedBranch(nextRepository?.defaultBranch ?? "");
      } catch (err) {
        if (cancelled) return;
        setRepositories([]);
        setGithubError(err instanceof Error ? err.message : "failed to load repositories");
      } finally {
        if (!cancelled) setIsLoadingRepositories(false);
      }
    }

    void loadRepositories();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstallationId]);

  useEffect(() => {
    if (!selectedRepositoryId) {
      return;
    }

    let cancelled = false;
    async function loadBranches() {
      setIsLoadingBranches(true);
      setBranches(null);
      setGithubError(null);
      try {
        const res = await fetch(
          `/api/github/repositories/${selectedRepositoryId}/branches`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { branches: GitHubBranch[] };
        if (cancelled) return;
        setBranches(data.branches);
        if (!data.branches.some((branch) => branch.name === selectedBranch)) {
          setSelectedBranch(data.branches[0]?.name ?? "");
        }
      } catch (err) {
        if (cancelled) return;
        setBranches([]);
        setGithubError(err instanceof Error ? err.message : "failed to load branches");
      } finally {
        if (!cancelled) setIsLoadingBranches(false);
      }
    }

    void loadBranches();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepositoryId]);

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
    if (!canCreate) return;
    setError(null);
    startCreate(async () => {
      const createBody: Record<string, string> = { name };
      if (sourceType === "github") {
        createBody.sourceType = "github";
        createBody.githubRepositoryId = selectedRepositoryId;
        createBody.githubBaseBranch = selectedBranch;
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createBody),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "failed");
        await refresh();
        return;
      }
      setName("");
      if (sourceType === "template") {
        setSelectedRepositoryId("");
        setSelectedBranch("");
      }
      await refresh();
    });
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and destroy its container?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    await refresh();
    await refreshOrphans();
  }

  async function removeOrphan(sandboxId: string) {
    if (!confirm(`Remove orphan sandbox ${sandboxId}?`)) return;
    setRemovingOrphanId(sandboxId);
    setOrphanError(null);
    try {
      const res = await fetch("/api/admin/orphan-sandboxes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshOrphans();
    } catch (err) {
      setOrphanError(err instanceof Error ? err.message : "failed to remove sandbox");
    } finally {
      setRemovingOrphanId(null);
    }
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/sign-in");
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

  function sandboxStatusBadge(status: OrphanSandbox["status"]) {
    const variants: Record<OrphanSandbox["status"], ComponentProps<typeof Badge>["variant"]> = {
      spawning: "warning",
      running: "success",
      stopped: "secondary",
      gone: "outline",
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  }

  const runningCount = projects?.filter((p) => p.status === "RUNNING").length ?? 0;
  const provisioningCount = projects?.filter((p) => p.status === "PROVISIONING").length ?? 0;
  const archivedCount =
    projects?.filter((p) => p.status === "ARCHIVED" || p.status === "DESTROYED").length ?? 0;
  const selectedRepository = repositories?.find((repo) => repo.id === selectedRepositoryId) ?? null;
  const canCreate = Boolean(name.trim()) &&
    (sourceType === "template" || Boolean(selectedRepositoryId && selectedBranch));

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">
              <Boxes className="size-3.5" />
              Docker workspace
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
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href="/agent-config">
                  <Settings2 />
                  Agent config
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/library">
                  <FolderKanban />
                  Library
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/usage">
                  <BarChart3 />
                  Usage
                </Link>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={signOut}>
                <LogOut />
                Sign out
              </Button>
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
              className="grid gap-4"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-foreground">Project name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={selectedRepository?.name ?? "Marketing site refresh"}
                    autoComplete="off"
                  />
                </label>
                <div className="flex items-end">
                  <Button type="submit" disabled={isCreating || !canCreate} className="w-full sm:w-auto">
                    {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
                    {isCreating ? "Provisioning…" : "Create"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3">
                <span className="text-sm font-medium text-foreground">Source</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={sourceType === "template" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceType("template")}
                  >
                    <Boxes />
                    Template
                  </Button>
                  <Button
                    type="button"
                    variant={sourceType === "github" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceType("github")}
                  >
                    <GitBranch />
                    GitHub
                  </Button>
                </div>
              </div>

              {sourceType === "github" && (
                <div className="grid gap-3 rounded-lg border border-border bg-secondary/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <GitBranch className="size-4" />
                      GitHub source
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={refreshGitHubInstallations}
                        aria-label="Refresh GitHub installations"
                      >
                        <RefreshCw />
                      </Button>
                      {installUrl && (
                        <Button asChild variant="outline" size="sm">
                          <a href={installUrl}>Install App</a>
                        </Button>
                      )}
                    </div>
                  </div>

                  {githubError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-red-200"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>{githubError}</span>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="grid gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Installation</span>
                      <select
                        value={selectedInstallationId}
                        onChange={(e) => {
                          setSelectedInstallationId(e.target.value);
                          setRepositories(null);
                          setSelectedRepositoryId("");
                          setBranches(null);
                          setSelectedBranch("");
                        }}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Select installation</option>
                        {(installations ?? []).map((installation) => (
                          <option key={installation.id} value={installation.id}>
                            {installation.accountLogin}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Repository</span>
                      <select
                        value={selectedRepositoryId}
                        onChange={(e) => {
                          const repo = repositories?.find((item) => item.id === e.target.value);
                          setSelectedRepositoryId(e.target.value);
                          setBranches(null);
                          setSelectedBranch(repo?.defaultBranch ?? "");
                        }}
                        disabled={!selectedInstallationId || isLoadingRepositories}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">
                          {isLoadingRepositories ? "Loading repositories…" : "Select repository"}
                        </option>
                        {(repositories ?? []).map((repository) => (
                          <option key={repository.id} value={repository.id}>
                            {repository.fullName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Branch</span>
                      <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={!selectedRepositoryId || isLoadingBranches}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">
                          {isLoadingBranches ? "Loading branches…" : "Select branch"}
                        </option>
                        {(branches ?? []).map((branch) => (
                          <option key={branch.sha} value={branch.name}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}
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
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Orphan sandboxes</h2>
              <p className="text-xs text-muted-foreground">Docker sandboxes that are no longer tracked in the database.</p>
            </div>
            <Button
              type="button"
              onClick={() => startRefreshOrphans(() => void refreshOrphans())}
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh orphan sandboxes"
            >
              <RefreshCw className={isRefreshingOrphans ? "animate-spin" : ""} />
            </Button>
          </div>

          {orphanError && (
            <div
              role="alert"
              className="m-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-red-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{orphanError}</span>
            </div>
          )}

          {orphanSandboxes === null ? (
            <div className="grid gap-3 p-4">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : orphanSandboxes.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No orphan sandboxes found.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {orphanSandboxes.map((sandbox) => (
                <li
                  key={sandbox.sandboxId}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm text-foreground">
                        {sandbox.sandboxId}
                      </span>
                      {sandboxStatusBadge(sandbox.status)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {sandbox.containerId && <span>container {sandbox.containerId.slice(0, 12)}</span>}
                      {sandbox.previewPort && <span>preview :{sandbox.previewPort}</span>}
                      {sandbox.brokerPort && <span>broker :{sandbox.brokerPort}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    {sandbox.previewPort && sandbox.status === "running" && (
                      <Button asChild variant="secondary" size="sm">
                        <a
                          href={localHttpUrlForBrowserPort(sandbox.previewPort, browserHostname)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Preview
                        </a>
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => removeOrphan(sandbox.sandboxId)}
                      disabled={removingOrphanId === sandbox.sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-destructive/30 text-red-200 hover:bg-destructive/10 hover:text-red-100"
                    >
                      {removingOrphanId === sandbox.sandboxId ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="size-3.5" />
                          {new Date(p.lastActive).toLocaleString()}
                        </span>
                        {p.sourceType === "GITHUB" && p.githubOwner && p.githubRepo && (
                          <span className="inline-flex items-center gap-1.5">
                            <GitBranch className="size-3.5" />
                            {p.githubOwner}/{p.githubRepo}
                            {p.githubBaseBranch ? `:${p.githubBaseBranch}` : ""}
                          </span>
                        )}
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
