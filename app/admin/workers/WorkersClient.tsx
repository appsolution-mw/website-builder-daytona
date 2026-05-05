"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  Waves,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WorkerStatus = "PROVISIONING" | "READY" | "DRAINING" | "DECOMMISSIONED" | "OFFLINE";

type AdminWorker = {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;
  providerVmId: string;
  region: string;
  capacity: number;
  status: WorkerStatus;
  lastHeartbeatAt: string | null;
  createdAt: string;
  decommissionedAt: string | null;
  serverType: string | null;
  provisioningError: string | null;
  readyAt: string | null;
  slotsUsed: number;
  slotsCapacity: number;
  slotsFree: number;
};

type WorkersResponse = {
  workers: AdminWorker[];
};

type ApiErrorResponse = {
  error?: string;
  message?: string;
};

const DEFAULT_REGION = "fsn1";
const DEFAULT_SERVER_TYPE = "ccx33";
const DEFAULT_CAPACITY = "10";

const statusVariants: Record<WorkerStatus, ComponentProps<typeof Badge>["variant"]> = {
  PROVISIONING: "warning",
  READY: "success",
  DRAINING: "secondary",
  DECOMMISSIONED: "outline",
  OFFLINE: "destructive",
};

export function WorkersClient(): ReactElement {
  const [workers, setWorkers] = useState<AdminWorker[] | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [serverType, setServerType] = useState(DEFAULT_SERVER_TYPE);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [isCreating, startCreateTransition] = useTransition();

  const loadWorkers = useCallback(async (): Promise<void> => {
    try {
      setWorkers(await fetchWorkers());
      setLoadError(null);
    } catch (error) {
      setWorkers([]);
      setLoadError(error instanceof Error ? error.message : "failed to load workers");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialWorkers(): Promise<void> {
      try {
        const nextWorkers = await fetchWorkers();
        if (cancelled) return;
        setWorkers(nextWorkers);
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setWorkers([]);
        setLoadError(error instanceof Error ? error.message : "failed to load workers");
      }
    }

    void loadInitialWorkers();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const items = workers ?? [];
    return {
      ready: items.filter((worker) => worker.status === "READY").length,
      draining: items.filter((worker) => worker.status === "DRAINING").length,
      used: items.reduce((total, worker) => total + worker.slotsUsed, 0),
      capacity: items.reduce((total, worker) => total + worker.slotsCapacity, 0),
    };
  }, [workers]);

  const canCreate = Boolean(name.trim()) &&
    Boolean(region.trim()) &&
    Boolean(serverType.trim()) &&
    Number.isSafeInteger(Number(capacity)) &&
    Number(capacity) > 0;

  function refresh(): void {
    setActionError(null);
    startRefreshTransition(async () => {
      await loadWorkers();
    });
  }

  function createWorker(): void {
    if (!canCreate) return;
    setFormError(null);
    startCreateTransition(async () => {
      try {
        const response = await fetch("/api/admin/workers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            region: region.trim(),
            serverType: serverType.trim(),
            capacity: Number(capacity),
          }),
        });
        if (!response.ok) {
          throw new Error(await errorMessage(response, "failed to create worker"));
        }
        setName("");
        setCapacity(DEFAULT_CAPACITY);
        await loadWorkers();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "failed to create worker");
      }
    });
  }

  async function runWorkerAction(worker: AdminWorker, action: "drain" | "retry" | "delete"): Promise<void> {
    if (action === "delete") {
      const confirmed = window.confirm(
        `Decommission ${worker.name}? This expects the worker to be draining and empty.`,
      );
      if (!confirmed) return;
    }

    setActionError(null);
    setActiveWorkerId(`${worker.id}:${action}`);
    try {
      const response = await fetch(workerActionUrl(worker.id, action), {
        method: action === "delete" ? "DELETE" : "POST",
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, `failed to ${action} worker`));
      }
      await loadWorkers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `failed to ${action} worker`);
    } finally {
      setActiveWorkerId(null);
    }
  }

  return (
    <div className="grid gap-5">
      <section aria-label="Worker pool summary" className="grid gap-2 sm:grid-cols-4">
        <SummaryTile label="ready" value={totals.ready} />
        <SummaryTile label="draining" value={totals.draining} />
        <SummaryTile label="used slots" value={totals.used} />
        <SummaryTile label="capacity" value={totals.capacity} />
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          createWorker();
        }}
        className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Create worker</h2>
            <p className="text-xs text-muted-foreground">
              Defaults target Hetzner fsn1 with ccx33 capacity.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={!canCreate || isCreating} className="w-full sm:w-auto">
            {isCreating ? <Loader2 className="animate-spin" /> : <Server />}
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_8rem_9rem_7rem]">
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="worker-fsn1-01"
              autoComplete="off"
            />
          </Field>
          <Field label="Region">
            <Input value={region} onChange={(event) => setRegion(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="Server type">
            <Input
              value={serverType}
              onChange={(event) => setServerType(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Capacity">
            <Input
              type="number"
              min={1}
              step={1}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              inputMode="numeric"
            />
          </Field>
        </div>

        {formError && <ErrorNotice message={formError} />}
      </form>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-foreground">Workers</div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          Refresh all
        </Button>
      </div>

      {loadError && <ErrorNotice message={loadError} />}
      {actionError && <ErrorNotice message={actionError} />}

      <section aria-label="Worker list" className="grid gap-3">
        {workers === null ? (
          <LoadingRows />
        ) : workers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No workers found.
          </div>
        ) : (
          workers.map((worker) => (
            <WorkerRow
              key={worker.id}
              worker={worker}
              activeWorkerId={activeWorkerId}
              onAction={runWorkerAction}
            />
          ))
        )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function WorkerRow({
  worker,
  activeWorkerId,
  onAction,
}: {
  worker: AdminWorker;
  activeWorkerId: string | null;
  onAction: (worker: AdminWorker, action: "drain" | "retry" | "delete") => Promise<void>;
}): ReactElement {
  const slotPercent = worker.slotsCapacity > 0
    ? Math.min(100, Math.round((worker.slotsUsed / worker.slotsCapacity) * 100))
    : 0;
  const isDrainActive = activeWorkerId === `${worker.id}:drain`;
  const isRetryActive = activeWorkerId === `${worker.id}:retry`;
  const isDeleteActive = activeWorkerId === `${worker.id}:delete`;

  return (
    <Card className="shadow-none">
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Server className="size-4 shrink-0 text-muted-foreground" />
              <CardTitle className="min-w-0 truncate text-sm">{worker.name}</CardTitle>
              <StatusBadge status={worker.status} />
              {worker.provisioningError && (
                <Badge variant="destructive">
                  <AlertTriangle className="size-3" />
                  error
                </Badge>
              )}
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
              <Meta label="region" value={worker.region} />
              <Meta label="type" value={worker.serverType ?? "n/a"} />
              <Meta label="provider" value={worker.provider} />
              <Meta label="vm" value={worker.providerVmId} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void onAction(worker, "drain")}
              disabled={worker.status !== "READY" || isDrainActive}
            >
              {isDrainActive ? <Loader2 className="animate-spin" /> : <Waves />}
              Drain
            </Button>
            {worker.provisioningError && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void onAction(worker, "retry")}
                disabled={isRetryActive}
              >
                {isRetryActive ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Retry
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => void onAction(worker, "delete")}
              disabled={isDeleteActive}
              aria-label={`Decommission ${worker.name}`}
            >
              {isDeleteActive ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 p-4 pt-0">
        <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <Meta label="tailnet IP" value={worker.tailscaleIp || "pending"} />
          <Meta label="hostname" value={worker.tailscaleHostname || "pending"} />
          <Meta label="heartbeat" value={formatDateTime(worker.lastHeartbeatAt)} />
          <Meta label="ready" value={formatDateTime(worker.readyAt)} />
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-foreground">Slots</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {worker.slotsUsed}/{worker.slotsCapacity} used, {worker.slotsFree} free
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-secondary"
            role="meter"
            aria-label={`${worker.name} slot usage`}
            aria-valuemin={0}
            aria-valuemax={worker.slotsCapacity}
            aria-valuenow={worker.slotsUsed}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${slotPercent}%` }} />
          </div>
        </div>

        {worker.provisioningError && (
          <div
            role="alert"
            className="min-w-0 rounded-md border border-destructive/25 bg-destructive/10 p-2 text-xs text-destructive dark:text-red-300"
          >
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5 shrink-0" />
              Provisioning error
            </div>
            <p className="break-words leading-5">{worker.provisioningError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: WorkerStatus }): ReactElement {
  return (
    <Badge variant={statusVariants[status]}>
      {status === "READY" && <CheckCircle2 className="size-3" />}
      {status.toLowerCase()}
    </Badge>
  );
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] uppercase text-muted-foreground">{label}</div>
      <div className="truncate font-medium tabular-nums text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }): ReactElement {
  return (
    <div
      role="alert"
      className="flex min-w-0 items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive dark:text-red-300"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

function LoadingRows(): ReactElement {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-32 animate-pulse rounded-lg border border-border bg-secondary/30" />
      ))}
    </div>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
  return body?.message ?? body?.error ?? `${fallback}: HTTP ${response.status}`;
}

async function fetchWorkers(): Promise<AdminWorker[]> {
  const response = await fetch("/api/admin/workers", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "failed to load workers"));
  }
  const data = (await response.json()) as WorkersResponse;
  return data.workers;
}

function workerActionUrl(workerId: string, action: "drain" | "retry" | "delete"): string {
  const basePath = `/api/admin/workers/${encodeURIComponent(workerId)}`;
  if (action === "delete") return basePath;
  return `${basePath}/${action}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
