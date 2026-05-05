import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import type { WorkerProvisioner } from "@/lib/runtime/types";
import {
  decommissionEmptyWorker,
  drainWorker,
  listWorkers,
  parseCreateWorkerInput,
  retryFailedHetznerWorker,
} from "../workers";

async function seedWorker(args: {
  id?: string;
  name?: string;
  provider?: string;
  providerVmId?: string;
  region?: string;
  capacity?: number;
  status?: "PROVISIONING" | "READY" | "DRAINING" | "DECOMMISSIONED" | "OFFLINE";
  serverType?: string | null;
  provisioningError?: string | null;
}) {
  const id = args.id ?? `worker-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.worker.create({
    data: {
      id,
      name: args.name ?? id,
      tailscaleHostname: `${id}.tailnet.test`,
      tailscaleIp: "100.64.1.10",
      provider: args.provider ?? "hetzner",
      providerVmId: args.providerVmId ?? `vm-${id}`,
      region: args.region ?? "fsn1",
      capacity: args.capacity ?? 4,
      status: args.status ?? "READY",
      serverType: args.serverType ?? "ccx33",
      provisioningError: args.provisioningError ?? null,
    },
  });
}

async function seedSandbox(args: {
  workerId: string;
  id?: string;
  status: "SPAWNING" | "RUNNING" | "STOPPED" | "PAUSED" | "DESTROYED";
}) {
  return prisma.workerSandbox.create({
    data: {
      id: args.id ?? `sandbox-${Math.random().toString(36).slice(2, 8)}`,
      workerId: args.workerId,
      projectId: `project-${Math.random().toString(36).slice(2, 8)}`,
      containerId: `container-${Math.random().toString(36).slice(2, 8)}`,
      brokerPort: 30_000,
      previewPort: 30_001,
      status: args.status,
    },
  });
}

function createProvisioner(): WorkerProvisioner {
  return {
    providerId: "hetzner",
    provision: vi.fn<WorkerProvisioner["provision"]>(async (args) => ({
      id: "new-worker",
      name: args.name,
      tailscaleHostname: "new-worker.tailnet.test",
      tailscaleIp: "100.64.1.11",
      provider: "hetzner",
      providerVmId: "new-vm",
      region: args.region,
      capacity: args.capacity,
      status: "PROVISIONING",
      serverType: args.size,
      provisioningError: null,
      readyAt: null,
    })),
    destroy: vi.fn<WorkerProvisioner["destroy"]>(async () => undefined),
    listOwned: vi.fn<WorkerProvisioner["listOwned"]>(async () => []),
  };
}

describe("worker admin service", () => {
  beforeEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  it("serializes workers with used and free slot counts", async () => {
    const worker = await seedWorker({ id: "worker-a", capacity: 5 });
    await seedSandbox({ workerId: worker.id, status: "SPAWNING" });
    await seedSandbox({ workerId: worker.id, status: "RUNNING" });
    await seedSandbox({ workerId: worker.id, status: "STOPPED" });
    await seedSandbox({ workerId: worker.id, status: "PAUSED" });
    await seedSandbox({ workerId: worker.id, status: "DESTROYED" });

    const workers = await listWorkers();

    expect(workers).toHaveLength(1);
    expect(workers[0]).toEqual(
      expect.objectContaining({
        id: "worker-a",
        capacity: 5,
        slotsUsed: 3,
        slotsCapacity: 5,
        slotsFree: 2,
      }),
    );
  });

  it("parses and trims valid create input", () => {
    const parsed = parseCreateWorkerInput({
      name: "  worker-one  ",
      region: " fsn1 ",
      serverType: " ccx33 ",
      capacity: 3,
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "worker-one",
        region: "fsn1",
        serverType: "ccx33",
        capacity: 3,
      },
    });
  });

  it("rejects create input with missing strings or non-positive capacity", () => {
    expect(parseCreateWorkerInput({
      name: "",
      region: "fsn1",
      serverType: "ccx33",
      capacity: 1,
    })).toEqual({ ok: false, error: "name is required" });

    expect(parseCreateWorkerInput({
      name: "worker-one",
      region: "fsn1",
      serverType: "ccx33",
      capacity: 1.5,
    })).toEqual({ ok: false, error: "capacity must be a positive integer" });
  });

  it("changes a ready worker to draining", async () => {
    await seedWorker({ id: "worker-drain", status: "READY" });

    const result = await drainWorker("worker-drain");

    expect(result).toEqual({ ok: true });
    const worker = await prisma.worker.findUnique({ where: { id: "worker-drain" } });
    expect(worker?.status).toBe("DRAINING");
  });

  it("refuses to drain a decommissioned worker", async () => {
    await seedWorker({ id: "worker-dead", status: "DECOMMISSIONED" });

    await expect(drainWorker("worker-dead")).resolves.toEqual({
      ok: false,
      status: 409,
      error: "worker is not drainable",
    });
  });

  it("refuses to decommission a worker with slot-consuming sandboxes", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({ id: "worker-busy", status: "DRAINING" });
    await seedSandbox({ workerId: worker.id, status: "RUNNING" });

    const result = await decommissionEmptyWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "worker has active sandboxes",
    });
    expect(provisioner.destroy).not.toHaveBeenCalled();
  });

  it("decommissions an empty Hetzner worker through the provisioner", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({ id: "worker-empty", status: "DRAINING" });

    const result = await decommissionEmptyWorker(worker.id, provisioner);

    expect(result).toEqual({ ok: true });
    expect(provisioner.destroy).toHaveBeenCalledWith(worker.id);
  });

  it("refuses to decommission a ready worker before it is drained", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({ id: "worker-ready", status: "READY" });

    const result = await decommissionEmptyWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "worker must be draining",
    });
    expect(provisioner.destroy).not.toHaveBeenCalled();
  });

  it("retries an empty failed Hetzner worker by decommissioning it and provisioning a replacement", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({
      id: "worker-failed",
      name: "failed-worker",
      status: "PROVISIONING",
      region: "hel1",
      capacity: 7,
      serverType: "cpx31",
      provisioningError: "Tailscale device did not become ready",
    });

    const result = await retryFailedHetznerWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: true,
      worker: expect.objectContaining({
        id: "new-worker",
        name: "failed-worker",
        region: "hel1",
        capacity: 7,
        serverType: "cpx31",
      }),
    });
    expect(provisioner.provision).toHaveBeenCalledWith({
      name: "failed-worker",
      region: "hel1",
      size: "cpx31",
      capacity: 7,
    });
    const oldWorker = await prisma.worker.findUnique({ where: { id: "worker-failed" } });
    expect(oldWorker?.status).toBe("DECOMMISSIONED");
    expect(oldWorker?.decommissionedAt).toBeInstanceOf(Date);
  });

  it("does not retry non-retryable workers", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({
      id: "worker-not-failed",
      status: "PROVISIONING",
      provisioningError: null,
    });

    const result = await retryFailedHetznerWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "worker is not retryable",
    });
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it("does not retry failed workers with active sandboxes", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({
      id: "worker-failed-busy",
      status: "PROVISIONING",
      provisioningError: "hcloud unavailable",
    });
    await seedSandbox({ workerId: worker.id, status: "RUNNING" });

    const result = await retryFailedHetznerWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "worker has active sandboxes",
    });
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it("claims retryable workers so a second retry cannot create another replacement", async () => {
    const provisioner = createProvisioner();
    const worker = await seedWorker({
      id: "worker-claimed",
      status: "PROVISIONING",
      provisioningError: "hcloud unavailable",
    });

    await prisma.worker.update({
      where: { id: worker.id },
      data: { status: "OFFLINE" },
    });
    const result = await retryFailedHetznerWorker(worker.id, provisioner);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "worker is not retryable",
    });
    expect(provisioner.provision).not.toHaveBeenCalled();
  });
});
