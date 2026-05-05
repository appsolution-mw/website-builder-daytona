import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "../../../../../../../lib/db/client";
import { POST } from "../route";

const SECRET = "test-secret-32-chars-minimum-please";
process.env.WORKER_AGENT_HMAC_SECRET = SECRET;

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(`${ts}.${method}.${path}.${body}`).digest("hex");
}

async function makeReq(workerId: string, body: string, opts: { ts?: string; sig?: string } = {}) {
  const path = `/api/internal/workers/${workerId}/heartbeat`;
  const ts = opts.ts ?? new Date().toISOString();
  const sig = opts.sig ?? sign(ts, "POST", path, body);
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sig,
    },
    body,
  });
}

describe("POST /api/internal/workers/[id]/heartbeat", () => {
  beforeEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });
  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  it("returns 401 when HMAC headers missing", async () => {
    const req = new Request("http://localhost:3000/api/internal/workers/w1/heartbeat", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when HMAC signature invalid", async () => {
    const body = JSON.stringify({ runningSandboxes: 0, dockerVersion: "x", uptime: 1 });
    const req = await makeReq("w1", body, { sig: "0".repeat(64) });
    const res = await POST(req, { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when worker unknown", async () => {
    const body = JSON.stringify({ runningSandboxes: 0, dockerVersion: "x", uptime: 1 });
    const req = await makeReq("unknown-id", body);
    const res = await POST(req, { params: Promise.resolve({ id: "unknown-id" }) });
    expect(res.status).toBe(404);
  });

  it("returns 410 when worker DECOMMISSIONED", async () => {
    await prisma.worker.create({
      data: {
        id: "wdead", name: "dead worker", tailscaleHostname: "h-dead", tailscaleIp: "127.0.0.1",
        provider: "fake", providerVmId: "v", region: "local",
        capacity: 4, status: "DECOMMISSIONED", decommissionedAt: new Date(),
      },
    });
    const body = JSON.stringify({ runningSandboxes: 0, dockerVersion: "x", uptime: 1 });
    const req = await makeReq("wdead", body);
    const res = await POST(req, { params: Promise.resolve({ id: "wdead" }) });
    expect(res.status).toBe(410);
  });

  it("returns 204 and updates lastHeartbeatAt + status on valid heartbeat", async () => {
    await prisma.worker.create({
      data: {
        id: "w1", name: "ready worker", tailscaleHostname: "h-1", tailscaleIp: "127.0.0.1",
        provider: "fake", providerVmId: "v", region: "local",
        capacity: 4, status: "PROVISIONING",
      },
    });
    const body = JSON.stringify({ runningSandboxes: 0, dockerVersion: "x", uptime: 1 });
    const req = await makeReq("w1", body);
    const res = await POST(req, { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(204);

    const after = await prisma.worker.findUnique({ where: { id: "w1" } });
    expect(after?.status).toBe("READY");
    expect(after?.lastHeartbeatAt).toBeInstanceOf(Date);
    expect(after?.readyAt).toBeInstanceOf(Date);
  });

  it("keeps DRAINING workers out of scheduling on valid heartbeat", async () => {
    await prisma.worker.create({
      data: {
        id: "wdrain", name: "draining worker", tailscaleHostname: "h-drain", tailscaleIp: "127.0.0.1",
        provider: "fake", providerVmId: "v", region: "local",
        capacity: 4, status: "DRAINING",
      },
    });
    const body = JSON.stringify({ runningSandboxes: 0, dockerVersion: "x", uptime: 1 });
    const req = await makeReq("wdrain", body);
    const res = await POST(req, { params: Promise.resolve({ id: "wdrain" }) });
    expect(res.status).toBe(204);

    const after = await prisma.worker.findUnique({ where: { id: "wdrain" } });
    expect(after?.status).toBe("DRAINING");
    expect(after?.lastHeartbeatAt).toBeInstanceOf(Date);
  });
});
