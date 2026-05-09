import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "../../../../../../../lib/db/client";
import { POST } from "../route";

const SECRET = "test-secret-32-chars-minimum-please";
process.env.WORKER_AGENT_HMAC_SECRET = SECRET;

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", SECRET).update(`${ts}.${method}.${path}.${body}`).digest("hex");
}

async function makeReq(sandboxId: string, body: string, opts: { ts?: string; sig?: string } = {}) {
  const path = `/api/internal/sandboxes/${sandboxId}/broker-ready`;
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

async function seedWorkerWithSandbox(workerId: string, sandboxId: string, projectId: string, ports: { broker: number; preview: number }) {
  await prisma.worker.create({
    data: {
      id: workerId, name: workerId, tailscaleHostname: `h-${workerId}`, tailscaleIp: "127.0.0.1",
      provider: "fake", providerVmId: "v", region: "local",
      capacity: 4, status: "READY",
    },
  });
  await prisma.user.upsert({
    where: { id: `user-${workerId}` },
    update: {},
    create: { id: `user-${workerId}`, email: `${workerId}@example.test`, name: workerId },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: `proj-${projectId}`,
      ownerId: `user-${workerId}`,
      sandboxId,
      brokerReady: false,
    },
  });
  await prisma.workerSandbox.create({
    data: {
      id: sandboxId,
      workerId,
      projectId,
      containerId: `cid-${sandboxId}`,
      brokerPort: ports.broker,
      previewPort: ports.preview,
      status: "RUNNING",
    },
  });
}

async function cleanup() {
  await prisma.workerSandbox.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.user.deleteMany({});
}

describe("POST /api/internal/sandboxes/[id]/broker-ready", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("flips brokerReady and returns 204 with empty body", async () => {
    await seedWorkerWithSandbox("w1", "sb1", "p1", { broker: 30000, preview: 30001 });

    const req = await makeReq("sb1", "{}");
    const res = await POST(req, { params: Promise.resolve({ id: "sb1" }) });
    expect(res.status).toBe(204);

    const proj = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(proj?.brokerReady).toBe(true);
    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb1" } });
    expect(sb?.brokerPort).toBe(30000);
    expect(sb?.previewPort).toBe(30001);
  });

  it("updates cached brokerPort and previewPort when reported values differ", async () => {
    await seedWorkerWithSandbox("w2", "sb2", "p2", { broker: 30000, preview: 30001 });

    const body = JSON.stringify({ brokerPort: 38881, previewPort: 38882 });
    const req = await makeReq("sb2", body);
    const res = await POST(req, { params: Promise.resolve({ id: "sb2" }) });
    expect(res.status).toBe(204);

    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb2" } });
    expect(sb?.brokerPort).toBe(38881);
    expect(sb?.previewPort).toBe(38882);

    const proj = await prisma.project.findUnique({ where: { id: "p2" } });
    expect(proj?.brokerReady).toBe(true);
  });

  it("does not change ports when reported values match cached values", async () => {
    await seedWorkerWithSandbox("w3", "sb3", "p3", { broker: 30000, preview: 30001 });

    const body = JSON.stringify({ brokerPort: 30000, previewPort: 30001 });
    const req = await makeReq("sb3", body);
    const res = await POST(req, { params: Promise.resolve({ id: "sb3" }) });
    expect(res.status).toBe(204);

    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb3" } });
    expect(sb?.brokerPort).toBe(30000);
    expect(sb?.previewPort).toBe(30001);
  });

  it("ignores invalid (non-positive) port values", async () => {
    await seedWorkerWithSandbox("w4", "sb4", "p4", { broker: 30000, preview: 30001 });

    const body = JSON.stringify({ brokerPort: 0, previewPort: -5 });
    const req = await makeReq("sb4", body);
    const res = await POST(req, { params: Promise.resolve({ id: "sb4" }) });
    expect(res.status).toBe(204);

    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb4" } });
    expect(sb?.brokerPort).toBe(30000);
    expect(sb?.previewPort).toBe(30001);
  });

  it("accepts legacy payload (empty body) without touching ports", async () => {
    await seedWorkerWithSandbox("w5", "sb5", "p5", { broker: 30000, preview: 30001 });

    const req = await makeReq("sb5", "");
    const res = await POST(req, { params: Promise.resolve({ id: "sb5" }) });
    expect(res.status).toBe(204);

    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb5" } });
    expect(sb?.brokerPort).toBe(30000);
    expect(sb?.previewPort).toBe(30001);

    const proj = await prisma.project.findUnique({ where: { id: "p5" } });
    expect(proj?.brokerReady).toBe(true);
  });

  it("updates only brokerPort when only brokerPort is reported", async () => {
    await seedWorkerWithSandbox("w6", "sb6", "p6", { broker: 30000, preview: 30001 });

    const body = JSON.stringify({ brokerPort: 38000 });
    const req = await makeReq("sb6", body);
    const res = await POST(req, { params: Promise.resolve({ id: "sb6" }) });
    expect(res.status).toBe(204);

    const sb = await prisma.workerSandbox.findUnique({ where: { id: "sb6" } });
    expect(sb?.brokerPort).toBe(38000);
    expect(sb?.previewPort).toBe(30001);
  });

  it("returns 401 when HMAC headers missing", async () => {
    const req = new Request("http://localhost:3000/api/internal/sandboxes/x/broker-ready", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when sandbox unknown", async () => {
    const req = await makeReq("does-not-exist", "{}");
    const res = await POST(req, { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });
});
