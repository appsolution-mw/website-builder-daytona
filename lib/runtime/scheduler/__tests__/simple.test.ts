import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../db/client";
import { createSimpleScheduler } from "../simple";
import type { WorkerStatus } from "../../types";

async function seedWorker(args: {
  capacity: number;
  status?: WorkerStatus;
  provider?: string;
  region?: string;
}) {
  return prisma.worker.create({
    data: {
      name: `test-worker-${Math.random().toString(36).slice(2, 8)}`,
      tailscaleHostname: `w-${Math.random().toString(36).slice(2, 8)}`,
      tailscaleIp: "100.64.1.1",
      provider: args.provider ?? "fake",
      providerVmId: "vm",
      region: args.region ?? "fsn1",
      capacity: args.capacity,
      status: args.status ?? "READY",
    },
  });
}

async function seedSandbox(workerId: string, projectId: string, status: "SPAWNING" | "RUNNING" | "STOPPED" | "PAUSED" | "DESTROYED") {
  return prisma.workerSandbox.create({
    data: {
      workerId,
      projectId,
      containerId: `c-${Math.random().toString(36).slice(2, 8)}`,
      brokerPort: 30000,
      previewPort: 30001,
      status,
    },
  });
}

describe("SimpleScheduler", () => {
  beforeEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  it("returns null when no workers exist", async () => {
    const s = createSimpleScheduler();
    expect(await s.pickWorker({})).toBeNull();
  });

  it("picks the only READY worker with capacity", async () => {
    const w = await seedWorker({ capacity: 4 });
    const s = createSimpleScheduler();
    const picked = await s.pickWorker({});
    expect(picked?.id).toBe(w.id);
  });

  it("ignores non-READY workers", async () => {
    await seedWorker({ capacity: 4, status: "PROVISIONING" });
    await seedWorker({ capacity: 4, status: "DRAINING" });
    await seedWorker({ capacity: 4, status: "OFFLINE" });
    const s = createSimpleScheduler();
    expect(await s.pickWorker({})).toBeNull();
  });

  it("prefers the least used worker over the worker with the most free capacity", async () => {
    const a = await seedWorker({ capacity: 10 });
    const b = await seedWorker({ capacity: 4 });
    // a has more free capacity, but b has fewer occupied slots.
    await seedSandbox(a.id, "p1", "RUNNING");
    await seedSandbox(a.id, "p2", "SPAWNING");
    await seedSandbox(b.id, "p3", "RUNNING");

    const s = createSimpleScheduler();
    const picked = await s.pickWorker({});
    expect(picked?.id).toBe(b.id);
  });

  it("counts stopped sandboxes against capacity but ignores destroyed sandboxes", async () => {
    const w = await seedWorker({ capacity: 2 });
    await seedSandbox(w.id, "p1", "STOPPED");
    await seedSandbox(w.id, "p2", "DESTROYED");
    await seedSandbox(w.id, "p3", "RUNNING");
    const s = createSimpleScheduler();
    expect(await s.pickWorker({})).toBeNull();
  });

  it("picks the least used ready worker", async () => {
    const a = await seedWorker({ capacity: 10 });
    const b = await seedWorker({ capacity: 10 });
    await seedSandbox(a.id, "p1", "RUNNING");
    await seedSandbox(a.id, "p2", "SPAWNING");
    await seedSandbox(b.id, "p3", "RUNNING");

    const s = createSimpleScheduler();
    const picked = await s.pickWorker({});
    expect(picked?.id).toBe(b.id);
  });

  it("returns null when all workers are at capacity", async () => {
    const w = await seedWorker({ capacity: 1 });
    await seedSandbox(w.id, "p1", "RUNNING");
    const s = createSimpleScheduler();
    expect(await s.pickWorker({})).toBeNull();
  });
});
