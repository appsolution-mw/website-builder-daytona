import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";

const mockProvision = vi.hoisted(() => vi.fn());
const mockDestroy = vi.hoisted(() => vi.fn());
const mockListOwned = vi.hoisted(() => vi.fn());
const originalDevUserId = process.env.DEV_USER_ID;
const originalAdminUserIds = process.env.ADMIN_USER_IDS;
const originalAdminEmails = process.env.ADMIN_EMAILS;

vi.mock("@/lib/runtime/provisioner/hetzner", () => ({
  createHetznerWorkerProvisionerFromEnv: vi.fn(() => ({
    providerId: "hetzner",
    provision: mockProvision,
    destroy: mockDestroy,
    listOwned: mockListOwned,
  })),
}));

type RouteContext = { params: Promise<{ id: string }> };

function context(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

async function seedWorker(id: string): Promise<void> {
  await prisma.worker.create({
    data: {
      id,
      name: id,
      tailscaleHostname: `${id}.tailnet.test`,
      tailscaleIp: "100.64.1.10",
      provider: "hetzner",
      providerVmId: `vm-${id}`,
      region: "fsn1",
      capacity: 3,
      status: "DRAINING",
      serverType: "ccx33",
    },
  });
}

describe("DELETE /api/admin/workers/[id]", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DEV_USER_ID = "admin-test-user";
    delete process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_EMAILS;
    mockDestroy.mockResolvedValue(undefined);
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    if (originalDevUserId === undefined) delete process.env.DEV_USER_ID;
    else process.env.DEV_USER_ID = originalDevUserId;
    if (originalAdminUserIds === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = originalAdminUserIds;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  it("requires authentication", async () => {
    delete process.env.DEV_USER_ID;
    await seedWorker("worker-auth");

    const { DELETE } = await import("../route");
    const response = await DELETE(
      new Request("http://localhost/api/admin/workers/worker-auth", { method: "DELETE" }),
      context("worker-auth"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "not signed in" });
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it("refuses to decommission a worker with slot-consuming sandboxes", async () => {
    await seedWorker("worker-busy");
    await prisma.workerSandbox.create({
      data: {
        id: "sandbox-running",
        workerId: "worker-busy",
        projectId: "project-one",
        containerId: "container-one",
        brokerPort: 30_000,
        previewPort: 30_001,
        status: "RUNNING",
      },
    });

    const { DELETE } = await import("../route");
    const response = await DELETE(
      new Request("http://localhost/api/admin/workers/worker-busy", { method: "DELETE" }),
      context("worker-busy"),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "worker has active sandboxes" });
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it("decommissions an empty worker", async () => {
    await seedWorker("worker-empty");

    const { DELETE } = await import("../route");
    const response = await DELETE(
      new Request("http://localhost/api/admin/workers/worker-empty", { method: "DELETE" }),
      context("worker-empty"),
    );

    expect(response.status).toBe(204);
    expect(mockDestroy).toHaveBeenCalledWith("worker-empty");
  });

  it("refuses to decommission a ready worker before drain", async () => {
    await seedWorker("worker-ready");
    await prisma.worker.update({
      where: { id: "worker-ready" },
      data: { status: "READY" },
    });

    const { DELETE } = await import("../route");
    const response = await DELETE(
      new Request("http://localhost/api/admin/workers/worker-ready", { method: "DELETE" }),
      context("worker-ready"),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "worker must be draining" });
    expect(mockDestroy).not.toHaveBeenCalled();
  });
});
