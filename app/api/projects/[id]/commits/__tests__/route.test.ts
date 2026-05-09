import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET } from "../route";

const DEV_USER_ID = "commits-route-user";
const OTHER_USER_ID = "commits-route-other";
const PROJECT_ID = "commits-route-project";
const OTHER_PROJECT_ID = "commits-route-other-project";

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
      name: "Commits Route Project",
    },
  });
}

async function createOtherProject(): Promise<void> {
  await prisma.project.create({
    data: {
      id: OTHER_PROJECT_ID,
      ownerId: OTHER_USER_ID,
      name: "Commits Route Other Project",
    },
  });
}

function routeContext(projectId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: projectId }) };
}

describe("GET /api/projects/[id]/commits", () => {
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
    await createUser(DEV_USER_ID, "commits-route-user@example.com");
    await createUser(OTHER_USER_ID, "commits-route-other@example.com");
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns the project's commits in desc order, paginated", async () => {
    await createOwnedProject();
    for (let i = 0; i < 25; i++) {
      await prisma.commit.create({
        data: {
          projectId: PROJECT_ID,
          sha: i.toString().padStart(40, "0"),
          shortSha: i.toString().padStart(7, "0"),
          authorKind: "AGENT",
          runtime: "CLAUDE_CODE",
          modelId: "sonnet-4-6",
          title: `commit ${i}`,
          bodyMessage: "body",
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
          createdAt: new Date(2026, 4, i + 1),
        },
      });
    }

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/commits?limit=10`),
      routeContext(PROJECT_ID),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commits).toHaveLength(10);
    expect(body.commits[0].title).toBe("commit 24");
    expect(body.nextCursor).toBeTruthy();
  });

  it("rejects requests for projects the user does not own", async () => {
    await createOtherProject();

    const res = await GET(
      new Request(`http://localhost/api/projects/${OTHER_PROJECT_ID}/commits`),
      routeContext(OTHER_PROJECT_ID),
    );

    expect(res.status).toBe(404);
  });
});
