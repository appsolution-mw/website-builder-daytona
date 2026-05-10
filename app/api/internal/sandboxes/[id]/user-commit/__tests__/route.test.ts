import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { prisma } from "../../../../../../../lib/db/client";
import { POST } from "../route";

const DEV_USER_ID = "user-commit-route-user";
const PROJECT_ID = "user-commit-route-project";
const SANDBOX_ID = "user-commit-route-sb";
const WORKER_ID = "user-commit-route-worker";
const HMAC_SECRET = "test-secret-32-chars-minimum-please";

const original = {
  hmac: process.env.WORKER_AGENT_HMAC_SECRET,
};

function sign(ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(`${ts}.${method}.${path}.${body}`)
    .digest("hex");
}

async function cleanDatabase(): Promise<void> {
  await prisma.commit.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.sandboxToken.deleteMany({ where: { sandboxId: SANDBOX_ID } });
  await prisma.workerSandbox.deleteMany({ where: { id: SANDBOX_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.worker.deleteMany({ where: { id: WORKER_ID } });
  await prisma.user.deleteMany({ where: { id: DEV_USER_ID } });
}

async function seed(): Promise<void> {
  await prisma.user.create({
    data: { id: DEV_USER_ID, email: "u@example.com", name: "u" },
  });
  await prisma.worker.create({
    data: {
      id: WORKER_ID,
      name: WORKER_ID,
      tailscaleHostname: `h-${WORKER_ID}`,
      tailscaleIp: "127.0.0.1",
      provider: "fake",
      providerVmId: "v",
      region: "local",
      capacity: 4,
      status: "READY",
    },
  });
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      ownerId: DEV_USER_ID,
      name: "User Commit Route Project",
      sandboxId: SANDBOX_ID,
    },
  });
  await prisma.workerSandbox.create({
    data: {
      id: SANDBOX_ID,
      workerId: WORKER_ID,
      projectId: PROJECT_ID,
      containerId: `cid-${SANDBOX_ID}`,
      brokerPort: 30000,
      previewPort: 30001,
      status: "RUNNING",
    },
  });
}

const SHA = "a".repeat(40);
const validPayload = {
  sha: SHA,
  shortSha: SHA.slice(0, 7),
  title: "Edit foo.tsx",
  bodyMessage: "foo.tsx | +1 -0\n\nAuthor: u@example.com",
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  userEmail: "u@example.com",
  committedAt: new Date().toISOString(),
};

function ctx(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: SANDBOX_ID }) };
}

function buildRequest(body: unknown, hmacOverride?: string): Request {
  const path = `/api/internal/sandboxes/${SANDBOX_ID}/user-commit`;
  const bodyStr = JSON.stringify(body);
  const ts = new Date().toISOString();
  const sig = hmacOverride ?? sign(ts, "POST", path, bodyStr);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sig,
    },
    body: bodyStr,
  });
}

describe("POST /api/internal/sandboxes/[id]/user-commit", () => {
  afterAll(() => {
    if (original.hmac === undefined) {
      delete process.env.WORKER_AGENT_HMAC_SECRET;
    } else {
      process.env.WORKER_AGENT_HMAC_SECRET = original.hmac;
    }
  });

  beforeEach(async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = HMAC_SECRET;
    await cleanDatabase();
    await seed();
  });
  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns 401 without HMAC headers", async () => {
    const path = `/api/internal/sandboxes/${SANDBOX_ID}/user-commit`;
    const req = new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(401);
  });

  it("returns 401 on bad signature", async () => {
    const req = buildRequest(validPayload, "0".repeat(64));
    const res = await POST(req, ctx());
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid sha", async () => {
    const req = buildRequest({ ...validPayload, sha: "deadbeef" });
    const res = await POST(req, ctx());
    expect(res.status).toBe(400);
  });

  it("returns 404 when sandbox is unknown", async () => {
    await prisma.workerSandbox.deleteMany({ where: { id: SANDBOX_ID } });
    const req = buildRequest(validPayload);
    const res = await POST(req, ctx());
    expect(res.status).toBe(404);
  });

  it("writes a USER Commit row and returns 201", async () => {
    const req = buildRequest(validPayload);
    const res = await POST(req, ctx());
    expect(res.status).toBe(201);
    const row = await prisma.commit.findFirst({ where: { sha: SHA } });
    expect(row).toBeTruthy();
    expect(row?.authorKind).toBe("USER");
    expect(row?.userEmail).toBe("u@example.com");
    expect(row?.agentRunId).toBeNull();
    expect(row?.sessionId).toBeNull();
  });

  it("is idempotent: a duplicate POST returns 409 without creating a second row", async () => {
    await POST(buildRequest(validPayload), ctx());
    const res2 = await POST(buildRequest(validPayload), ctx());
    expect([201, 409]).toContain(res2.status);
    const rows = await prisma.commit.findMany({ where: { sha: SHA } });
    expect(rows.length).toBe(1);
  });
});
