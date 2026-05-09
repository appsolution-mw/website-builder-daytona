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

describe("POST /api/admin/workers/[id]/retry", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.DEV_USER_ID = "admin-test-user";
    delete process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_EMAILS;
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    mockProvision.mockResolvedValue({
      id: "worker-replacement",
      name: "worker-failed",
      tailscaleHostname: "worker-replacement.tailnet.test",
      tailscaleIp: "100.64.1.11",
      provider: "hetzner",
      providerVmId: "vm-worker-replacement",
      region: "hel1",
      capacity: 4,
      status: "PROVISIONING",
      serverType: "cpx31",
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
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  it("requires authentication", async () => {
    delete process.env.DEV_USER_ID;

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/workers/worker-failed/retry", { method: "POST" }),
      context("worker-failed"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "not signed in" });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("retries an empty failed Hetzner worker", async () => {
    await prisma.worker.create({
      data: {
        id: "worker-failed",
        name: "worker-failed",
        tailscaleHostname: "worker-failed.tailnet.test",
        tailscaleIp: "",
        provider: "hetzner",
        providerVmId: "pending",
        region: "hel1",
        capacity: 4,
        status: "PROVISIONING",
        serverType: "cpx31",
        provisioningError: "hcloud unavailable",
      },
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/workers/worker-failed/retry", { method: "POST" }),
      context("worker-failed"),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.worker).toEqual(expect.objectContaining({ id: "worker-replacement" }));
    expect(mockProvision).toHaveBeenCalledWith({
      name: "worker-failed",
      region: "hel1",
      size: "cpx31",
      capacity: 4,
    });
    const oldWorker = await prisma.worker.findUnique({ where: { id: "worker-failed" } });
    expect(oldWorker?.status).toBe("DECOMMISSIONED");
  });

  it("does not retry a failed worker with active sandboxes", async () => {
    await prisma.worker.create({
      data: {
        id: "worker-busy",
        name: "worker-busy",
        tailscaleHostname: "worker-busy.tailnet.test",
        tailscaleIp: "",
        provider: "hetzner",
        providerVmId: "pending",
        region: "hel1",
        capacity: 4,
        status: "PROVISIONING",
        serverType: "cpx31",
        provisioningError: "hcloud unavailable",
      },
    });
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

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/workers/worker-busy/retry", { method: "POST" }),
      context("worker-busy"),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "worker has active sandboxes" });
    expect(mockProvision).not.toHaveBeenCalled();
  });
});
