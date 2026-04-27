import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../db/client";
import { createFakeProvisioner } from "../fake";

describe("FakeProvisioner", () => {
  beforeEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  it("provision() inserts a READY Worker row with the requested region/size", async () => {
    const p = createFakeProvisioner();
    const w = await p.provision({ region: "fsn1", size: "ccx33", capacity: 4 });

    expect(w.provider).toBe("fake");
    expect(w.region).toBe("fsn1");
    expect(w.capacity).toBe(4);
    expect(w.status).toBe("READY");
    expect(w.tailscaleHostname).toMatch(/^fake-worker-/);

    const row = await prisma.worker.findUnique({ where: { id: w.id } });
    expect(row?.status).toBe("READY");
    expect(row?.provider).toBe("fake");
  });

  it("destroy() marks the Worker DECOMMISSIONED", async () => {
    const p = createFakeProvisioner();
    const w = await p.provision({ region: "fsn1", size: "ccx33", capacity: 2 });

    await p.destroy(w.id);

    const row = await prisma.worker.findUnique({ where: { id: w.id } });
    expect(row?.status).toBe("DECOMMISSIONED");
    expect(row?.decommissionedAt).toBeInstanceOf(Date);
  });

  it("destroy() is idempotent for unknown ids", async () => {
    const p = createFakeProvisioner();
    await expect(p.destroy("does-not-exist")).resolves.toBeUndefined();
  });

  it("listOwned() returns only fake-provider workers in non-decommissioned state", async () => {
    const p = createFakeProvisioner();
    const a = await p.provision({ region: "fsn1", size: "ccx33", capacity: 2 });
    await p.provision({ region: "ash", size: "ccx33", capacity: 2 });

    // Insert a non-fake worker that listOwned should NOT see
    await prisma.worker.create({
      data: {
        tailscaleHostname: "real-1",
        tailscaleIp: "100.1.1.1",
        provider: "hetzner",
        providerVmId: "hzn-1",
        region: "fsn1",
        capacity: 8,
        status: "READY",
      },
    });

    await p.destroy(a.id);

    const owned = await p.listOwned();
    expect(owned).toHaveLength(1); // a is decommissioned, b remains, hetzner one is filtered
    expect(owned.every((w) => w.provider === "fake")).toBe(true);
  });
});
