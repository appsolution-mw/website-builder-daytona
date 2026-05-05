import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";

const mockProvision = vi.hoisted(() => vi.fn());
const mockDestroy = vi.hoisted(() => vi.fn());
const mockListOwned = vi.hoisted(() => vi.fn());
const originalDevUserId = process.env.DEV_USER_ID;
const originalAdminUserIds = process.env.ADMIN_USER_IDS;

vi.mock("@/lib/runtime/provisioner/hetzner", () => ({
  createHetznerWorkerProvisionerFromEnv: vi.fn(() => ({
    providerId: "hetzner",
    provision: mockProvision,
    destroy: mockDestroy,
    listOwned: mockListOwned,
  })),
}));

async function seedWorker(): Promise<{ id: string }> {
  return prisma.worker.create({
    data: {
      id: "worker-list",
      name: "worker-list",
      tailscaleHostname: "worker-list.tailnet.test",
      tailscaleIp: "100.64.1.10",
      provider: "hetzner",
      providerVmId: "vm-worker-list",
      region: "fsn1",
      capacity: 3,
      status: "READY",
      serverType: "ccx33",
    },
    select: { id: true },
  });
}

describe("/api/admin/workers", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DEV_USER_ID = "admin-test-user";
    delete process.env.ADMIN_USER_IDS;
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    mockProvision.mockResolvedValue({
      id: "created-worker",
      name: "created-worker",
      tailscaleHostname: "created-worker.tailnet.test",
      tailscaleIp: "100.64.1.11",
      provider: "hetzner",
      providerVmId: "vm-created-worker",
      region: "fsn1",
      capacity: 2,
      status: "PROVISIONING",
      serverType: "ccx33",
      provisioningError: null,
      readyAt: null,
    });
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    if (originalDevUserId === undefined) delete process.env.DEV_USER_ID;
    else process.env.DEV_USER_ID = originalDevUserId;
    if (originalAdminUserIds === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = originalAdminUserIds;
  });

  it("GET requires authentication", async () => {
    delete process.env.DEV_USER_ID;
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/workers"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "not signed in" });
  });

  it("GET requires admin access", async () => {
    process.env.ADMIN_USER_IDS = "other-admin";
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/workers"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "admin access required" });
  });

  it("GET returns workers with slot counts", async () => {
    const worker = await seedWorker();
    await prisma.workerSandbox.create({
      data: {
        id: "sandbox-running",
        workerId: worker.id,
        projectId: "project-one",
        containerId: "container-one",
        brokerPort: 30_000,
        previewPort: 30_001,
        status: "RUNNING",
      },
    });

    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/admin/workers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workers).toEqual([
      expect.objectContaining({
        id: "worker-list",
        slotsUsed: 1,
        slotsCapacity: 3,
        slotsFree: 2,
      }),
    ]);
  });

  it("POST validates create input", async () => {
    const { POST } = await import("../route");
    const response = await POST(new Request("http://localhost/api/admin/workers", {
      method: "POST",
      body: JSON.stringify({
        name: "worker-one",
        region: "fsn1",
        serverType: "ccx33",
        capacity: 0,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "capacity must be a positive integer" });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("POST provisions a Hetzner worker from valid create input", async () => {
    const { POST } = await import("../route");
    const response = await POST(new Request("http://localhost/api/admin/workers", {
      method: "POST",
      body: JSON.stringify({
        name: "created-worker",
        region: "fsn1",
        serverType: "ccx33",
        capacity: 2,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.worker).toEqual(expect.objectContaining({ id: "created-worker" }));
    expect(mockProvision).toHaveBeenCalledWith({
      name: "created-worker",
      region: "fsn1",
      size: "ccx33",
      capacity: 2,
    });
  });
});
