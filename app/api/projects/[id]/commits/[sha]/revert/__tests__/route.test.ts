import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../../../lib/db/client";
import { POST } from "../route";
import * as brokerRpc from "../../../../../../../../lib/runtime/broker-rpc";

const DEV_USER_ID = "revert-route-user";
const OTHER_USER_ID = "revert-route-other";
const PROJECT_ID = "revert-route-project";
const OTHER_PROJECT_ID = "revert-route-other-project";

const OLD_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const NEW_SHA = "c".repeat(40);

const originalDevUserId = process.env.DEV_USER_ID;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  const projectIds = [PROJECT_ID, OTHER_PROJECT_ID];
  await prisma.commit.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.agentRunEvent.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.agentRunAttempt.deleteMany({
    where: { run: { projectId: { in: projectIds } } },
  });
  await prisma.agentRun.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.message.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.session.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [DEV_USER_ID, OTHER_USER_ID] } } });
}

async function createUser(id: string, email: string): Promise<void> {
  await prisma.user.create({ data: { id, email } });
}

async function createOwnedProject(): Promise<void> {
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      ownerId: DEV_USER_ID,
      name: "Revert Route Project",
      brokerUrl: "ws://localhost:9999/",
      brokerPreviewToken: "test-token",
    },
  });
}

async function createCommit(
  projectId: string,
  sha: string,
  overrides: Partial<{ createdAt: Date; authorKind: "AGENT" | "USER" | "ROLLBACK" }> = {},
): Promise<void> {
  await prisma.commit.create({
    data: {
      projectId,
      sha,
      shortSha: sha.slice(0, 7),
      authorKind: overrides.authorKind ?? "AGENT",
      runtime: "CLAUDE_CODE",
      modelId: "sonnet-4-6",
      title: "test commit",
      bodyMessage: "body",
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

async function createActiveRun(status: "QUEUED" | "RUNNING"): Promise<void> {
  const session = await prisma.session.create({
    data: { projectId: PROJECT_ID, title: "Revert route session" },
    select: { id: true },
  });
  await prisma.agentRun.create({
    data: {
      projectId: PROJECT_ID,
      sessionId: session.id,
      createdById: DEV_USER_ID,
      runtime: "CLAUDE_CODE",
      providerSessionId: `provider-${status.toLowerCase()}`,
      queueSequence: 1,
      status,
    },
  });
}

function ctx(id: string, sha: string): { params: Promise<{ id: string; sha: string }> } {
  return { params: Promise.resolve({ id, sha }) };
}

function postReq(): Request {
  return new Request("http://localhost/", { method: "POST" });
}

describe("POST /api/projects/[id]/commits/[sha]/revert", () => {
  afterAll(() => {
    if (originalDevUserId === undefined) {
      delete process.env.DEV_USER_ID;
      return;
    }
    process.env.DEV_USER_ID = originalDevUserId;
  });

  beforeEach(async () => {
    process.env.DEV_USER_ID = DEV_USER_ID;
    await cleanDatabase();
    await createUser(DEV_USER_ID, "revert-route-user@example.com");
    await createUser(OTHER_USER_ID, "revert-route-other@example.com");
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns 400 when sha is malformed", async () => {
    await createOwnedProject();
    const res = await POST(postReq(), ctx(PROJECT_ID, "deadbeef"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no Commit row matches", async () => {
    await createOwnedProject();
    const res = await POST(postReq(), ctx(PROJECT_ID, OLD_SHA));
    expect(res.status).toBe(404);
  });

  it("returns 409 is_head when sha equals project HEAD", async () => {
    await createOwnedProject();
    await createCommit(PROJECT_ID, HEAD_SHA);
    const res = await POST(postReq(), ctx(PROJECT_ID, HEAD_SHA));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("is_head");
  });

  it("returns 409 not_idle when an AgentRun is RUNNING", async () => {
    await createOwnedProject();
    await createCommit(PROJECT_ID, OLD_SHA, { createdAt: new Date(2026, 0, 1) });
    await createCommit(PROJECT_ID, HEAD_SHA, { createdAt: new Date(2026, 0, 2) });
    await createActiveRun("RUNNING");
    const res = await POST(postReq(), ctx(PROJECT_ID, OLD_SHA));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not_idle");
  });

  it("calls broker, persists Commit row, returns 201 on success", async () => {
    await createOwnedProject();
    await createCommit(PROJECT_ID, OLD_SHA, { createdAt: new Date(2026, 0, 1) });
    await createCommit(PROJECT_ID, HEAD_SHA, { createdAt: new Date(2026, 0, 2) });

    const spy = vi
      .spyOn(brokerRpc, "brokerRevertToCommit")
      .mockResolvedValue({
        ok: true,
        sha: NEW_SHA,
        shortSha: NEW_SHA.slice(0, 7),
        title: `Revert to ${OLD_SHA.slice(0, 7)} — test commit`,
        bodyMessage: `Reverted-from: ${OLD_SHA}\nTriggered-by: user:${DEV_USER_ID}`,
        filesChanged: 1,
        insertions: 0,
        deletions: 3,
        revertedFromSha: OLD_SHA,
        committedAt: new Date().toISOString(),
      });

    const res = await POST(postReq(), ctx(PROJECT_ID, OLD_SHA));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.newSha).toBe(NEW_SHA);
    expect(body.revertedFromSha).toBe(OLD_SHA);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ brokerUrl: "ws://localhost:9999/" }),
      OLD_SHA,
      `user:${DEV_USER_ID}`,
    );

    const row = await prisma.commit.findFirst({ where: { sha: NEW_SHA } });
    expect(row).toBeTruthy();
    expect(row?.authorKind).toBe("ROLLBACK");
    expect(row?.revertedFromSha).toBe(OLD_SHA);
    expect(row?.agentRunId).toBeNull();
    expect(row?.sessionId).toBeNull();
  });

  it("maps broker dirty_tree to 400", async () => {
    await createOwnedProject();
    await createCommit(PROJECT_ID, OLD_SHA, { createdAt: new Date(2026, 0, 1) });
    await createCommit(PROJECT_ID, HEAD_SHA, { createdAt: new Date(2026, 0, 2) });
    vi.spyOn(brokerRpc, "brokerRevertToCommit").mockResolvedValue({
      ok: false,
      reason: "dirty_tree",
    });

    const res = await POST(postReq(), ctx(PROJECT_ID, OLD_SHA));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("dirty_tree");
  });
});
