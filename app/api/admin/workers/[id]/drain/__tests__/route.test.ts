import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";

const originalDevUserId = process.env.DEV_USER_ID;

type RouteContext = { params: Promise<{ id: string }> };

function context(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/workers/[id]/drain", () => {
  beforeEach(async () => {
    process.env.DEV_USER_ID = "admin-test-user";
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    if (originalDevUserId === undefined) delete process.env.DEV_USER_ID;
    else process.env.DEV_USER_ID = originalDevUserId;
  });

  it("requires authentication", async () => {
    delete process.env.DEV_USER_ID;

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/workers/worker-drain/drain", { method: "POST" }),
      context("worker-drain"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "not signed in" });
  });

  it("changes a ready worker to draining", async () => {
    await prisma.worker.create({
      data: {
        id: "worker-drain",
        name: "worker-drain",
        tailscaleHostname: "worker-drain.tailnet.test",
        tailscaleIp: "100.64.1.10",
        provider: "hetzner",
        providerVmId: "vm-worker-drain",
        region: "fsn1",
        capacity: 3,
        status: "READY",
        serverType: "ccx33",
      },
    });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://localhost/api/admin/workers/worker-drain/drain", { method: "POST" }),
      context("worker-drain"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const worker = await prisma.worker.findUnique({ where: { id: "worker-drain" } });
    expect(worker?.status).toBe("DRAINING");
  });
});
