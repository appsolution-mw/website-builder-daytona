import { prisma } from "@/lib/db/client";
import type { WorkerProvisioner, WorkerRecord, WorkerStatus } from "@/lib/runtime/types";

const SLOT_CONSUMING_SANDBOX_STATUSES = ["SPAWNING", "RUNNING", "STOPPED"] as const;

type AdminResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

type RetryResult =
  | { ok: true; worker: WorkerRecord }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface CreateWorkerInput {
  name: string;
  region: string;
  serverType: string;
  capacity: number;
}

export type ParseCreateWorkerInputResult =
  | { ok: true; value: CreateWorkerInput }
  | { ok: false; error: string };

export interface AdminWorker {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;
  providerVmId: string;
  region: string;
  capacity: number;
  status: WorkerStatus;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  decommissionedAt: Date | null;
  serverType: string | null;
  provisioningError: string | null;
  readyAt: Date | null;
  slotsUsed: number;
  slotsCapacity: number;
  slotsFree: number;
}

interface WorkerRow {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;
  providerVmId: string;
  region: string;
  capacity: number;
  status: string;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  decommissionedAt: Date | null;
  serverType: string | null;
  provisioningError: string | null;
  readyAt: Date | null;
  _count: {
    sandboxes: number;
  };
}

export async function listWorkers(): Promise<AdminWorker[]> {
  const workers = await prisma.worker.findMany({
    include: {
      _count: {
        select: {
          sandboxes: {
            where: { status: { in: [...SLOT_CONSUMING_SANDBOX_STATUSES] } },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return workers.map(serializeWorker);
}

export function parseCreateWorkerInput(input: unknown): ParseCreateWorkerInputResult {
  if (!isRecord(input)) {
    return { ok: false, error: "request body must be an object" };
  }

  const name = parseRequiredString(input.name, "name");
  if (!name.ok) return name;

  const region = parseRequiredString(input.region, "region");
  if (!region.ok) return region;

  const serverType = parseRequiredString(input.serverType, "serverType");
  if (!serverType.ok) return serverType;

  const capacity = typeof input.capacity === "number" ? input.capacity : NaN;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    return { ok: false, error: "capacity must be a positive integer" };
  }

  return {
    ok: true,
    value: {
      name: name.value,
      region: region.value,
      serverType: serverType.value,
      capacity,
    },
  };
}

export async function drainWorker(workerId: string): Promise<AdminResult> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { status: true },
  });

  if (!worker) return { ok: false, status: 404, error: "worker not found" };
  if (worker.status === "DRAINING") return { ok: true };
  if (worker.status !== "READY") {
    return { ok: false, status: 409, error: "worker is not drainable" };
  }

  await prisma.worker.update({
    where: { id: workerId },
    data: { status: "DRAINING" },
  });
  return { ok: true };
}

export async function decommissionEmptyWorker(
  workerId: string,
  provisioner: WorkerProvisioner,
): Promise<AdminResult> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, provider: true, status: true },
  });

  if (!worker) return { ok: false, status: 404, error: "worker not found" };
  if (worker.status === "DECOMMISSIONED") return { ok: true };
  if (worker.status !== "DRAINING") {
    return { ok: false, status: 409, error: "worker must be draining" };
  }

  const activeSandboxes = await countSlotConsumingSandboxes(worker.id);
  if (activeSandboxes > 0) {
    return { ok: false, status: 409, error: "worker has active sandboxes" };
  }

  if (worker.provider === provisioner.providerId) {
    await provisioner.destroy(worker.id);
    return { ok: true };
  }

  await markWorkerDecommissioned(worker.id);
  return { ok: true };
}

export async function retryFailedHetznerWorker(
  workerId: string,
  provisioner: WorkerProvisioner,
): Promise<RetryResult> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      name: true,
      provider: true,
      region: true,
      capacity: true,
      status: true,
      serverType: true,
      provisioningError: true,
    },
  });

  if (!worker) return { ok: false, status: 404, error: "worker not found" };
  if (worker.provider !== provisioner.providerId) {
    return { ok: false, status: 400, error: "worker provider is not retryable" };
  }
  if (worker.status !== "PROVISIONING" || !worker.provisioningError) {
    return { ok: false, status: 409, error: "worker is not retryable" };
  }
  if (!worker.serverType) {
    return { ok: false, status: 409, error: "worker serverType is required" };
  }

  const activeSandboxes = await countSlotConsumingSandboxes(worker.id);
  if (activeSandboxes > 0) {
    return { ok: false, status: 409, error: "worker has active sandboxes" };
  }

  const claimed = await prisma.worker.updateMany({
    where: {
      id: worker.id,
      provider: provisioner.providerId,
      status: "PROVISIONING",
      provisioningError: worker.provisioningError,
    },
    data: { status: "OFFLINE" },
  });
  if (claimed.count === 0) {
    return { ok: false, status: 409, error: "worker retry already started" };
  }

  await markWorkerDecommissioned(worker.id);
  const replacement = await provisioner.provision({
    name: worker.name,
    region: worker.region,
    size: worker.serverType,
    capacity: worker.capacity,
  });

  return { ok: true, worker: replacement };
}

function serializeWorker(worker: WorkerRow): AdminWorker {
  const slotsUsed = worker._count.sandboxes;
  return {
    id: worker.id,
    name: worker.name,
    tailscaleHostname: worker.tailscaleHostname,
    tailscaleIp: worker.tailscaleIp,
    provider: worker.provider,
    providerVmId: worker.providerVmId,
    region: worker.region,
    capacity: worker.capacity,
    status: worker.status as WorkerStatus,
    lastHeartbeatAt: worker.lastHeartbeatAt,
    createdAt: worker.createdAt,
    decommissionedAt: worker.decommissionedAt,
    serverType: worker.serverType,
    provisioningError: worker.provisioningError,
    readyAt: worker.readyAt,
    slotsUsed,
    slotsCapacity: worker.capacity,
    slotsFree: Math.max(0, worker.capacity - slotsUsed),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequiredString(
  value: unknown,
  fieldName: "name" | "region" | "serverType",
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldName} is required` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${fieldName} is required` };
  }

  return { ok: true, value: trimmed };
}

async function countSlotConsumingSandboxes(workerId: string): Promise<number> {
  return prisma.workerSandbox.count({
    where: {
      workerId,
      status: { in: [...SLOT_CONSUMING_SANDBOX_STATUSES] },
    },
  });
}

async function markWorkerDecommissioned(workerId: string): Promise<void> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, tailscaleHostname: true },
  });
  if (!worker) return;

  await prisma.worker.update({
    where: { id: workerId },
    data: {
      status: "DECOMMISSIONED",
      decommissionedAt: new Date(),
      tailscaleHostname: decommissionedHostname(worker.tailscaleHostname, worker.id),
    },
  });
}

function decommissionedHostname(hostname: string, workerId: string): string {
  if (hostname.includes("-decommissioned-")) return hostname;
  return `${hostname}-decommissioned-${workerId.slice(0, 8)}`;
}
