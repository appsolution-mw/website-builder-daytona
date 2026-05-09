import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../../../../../lib/db/client";
import { GET } from "../route";

const DEV_USER_ID = "commit-detail-route-user";
const OTHER_USER_ID = "commit-detail-route-other";
const PROJECT_ID = "commit-detail-route-project";
const OTHER_PROJECT_ID = "commit-detail-route-other-project";

const VALID_SHA = "a".repeat(40);
const VALID_SHA_OTHER = "b".repeat(40);

const originalDevUserId = process.env.DEV_USER_ID;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  const projectIds = [PROJECT_ID, OTHER_PROJECT_ID];
  await prisma.commit.deleteMany({ where: { projectId: { in: projectIds } } });
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
      name: "Commit Detail Route Project",
    },
  });
}

async function createOtherProject(): Promise<void> {
  await prisma.project.create({
    data: {
      id: OTHER_PROJECT_ID,
      ownerId: OTHER_USER_ID,
      name: "Commit Detail Route Other Project",
    },
  });
}

async function createCommit(projectId: string, sha: string): Promise<void> {
  await prisma.commit.create({
    data: {
      projectId,
      sha,
      shortSha: sha.slice(0, 7),
      authorKind: "AGENT",
      runtime: "CLAUDE_CODE",
      modelId: "sonnet-4-6",
      title: "test commit",
      bodyMessage: "body",
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    },
  });
}

function routeContext(
  projectId: string,
  sha: string,
): { params: Promise<{ id: string; sha: string }> } {
  return { params: Promise.resolve({ id: projectId, sha }) };
}

describe("GET /api/projects/[id]/commits/[sha]", () => {
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
    await createUser(DEV_USER_ID, "commit-detail-route-user@example.com");
    await createUser(OTHER_USER_ID, "commit-detail-route-other@example.com");
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns the commit when authed owner requests a valid sha", async () => {
    await createOwnedProject();
    await createCommit(PROJECT_ID, VALID_SHA);

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}`),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit.sha).toBe(VALID_SHA);
    expect(body.commit.title).toBe("test commit");
    expect(body.commit.runtime).toBe("CLAUDE_CODE");
  });

  it("returns 404 when the commit belongs to a project owned by another user", async () => {
    await createOtherProject();
    await createCommit(OTHER_PROJECT_ID, VALID_SHA_OTHER);

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${OTHER_PROJECT_ID}/commits/${VALID_SHA_OTHER}`,
      ),
      routeContext(OTHER_PROJECT_ID, VALID_SHA_OTHER),
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when the sha format is invalid", async () => {
    await createOwnedProject();

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/commits/bad-sha`),
      routeContext(PROJECT_ID, "bad-sha"),
    );

    expect(res.status).toBe(400);
  });
});
