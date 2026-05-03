import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET, PUT } from "../route";

const DEV_USER_ID = "environment-route-user";
const OTHER_USER_ID = "environment-route-other";
const PROJECT_ID = "environment-route-project";
const OTHER_PROJECT_ID = "environment-route-other-project";

const originalDevUserId = process.env.DEV_USER_ID;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  const projectIds = [PROJECT_ID, OTHER_PROJECT_ID];
  await prisma.message.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.session.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [DEV_USER_ID, OTHER_USER_ID] } } });
}

async function createOwnedProject(): Promise<void> {
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      ownerId: DEV_USER_ID,
      name: "Environment Route Project",
    },
  });
}

async function createOtherProject(): Promise<void> {
  await prisma.project.create({
    data: {
      id: OTHER_PROJECT_ID,
      ownerId: OTHER_USER_ID,
      name: "Environment Route Other Project",
    },
  });
}

async function createUser(id: string, email: string): Promise<void> {
  try {
    await prisma.user.create({ data: { id, email } });
  } catch {
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "email", "createdAt", "updatedAt")
      VALUES (${id}, ${email}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
  }
}

function routeContext(projectId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: projectId }) };
}

function putRequest(projectId: string, body: unknown): Request {
  return new Request(`http://localhost/api/projects/${projectId}/environment`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/projects/[id]/environment", () => {
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
    await createUser(DEV_USER_ID, "environment-route-user@example.com");
    await createUser(OTHER_USER_ID, "environment-route-other@example.com");
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns empty content when no env is saved", async () => {
    await createOwnedProject();

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`),
      routeContext(PROJECT_ID),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ content: "", updatedAt: null });
  });

  it("upserts and returns saved dotenv content preserving comments and newlines", async () => {
    await createOwnedProject();
    const content = "# local settings\nAPI_KEY=abc123\n\nFEATURE_FLAG=true\n";

    const putRes = await PUT(putRequest(PROJECT_ID, { content }), routeContext(PROJECT_ID));
    const putBody = await putRes.json();

    expect(putRes.status).toBe(200);
    expect(putBody).toEqual({
      content,
      updatedAt: expect.any(String),
    });
    expect(new Date(putBody.updatedAt).toISOString()).toBe(putBody.updatedAt);

    const getRes = await GET(
      new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`),
      routeContext(PROJECT_ID),
    );

    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual({
      content,
      updatedAt: putBody.updatedAt,
    });
  });

  it("returns 404 for another user's project", async () => {
    await createOtherProject();

    const getRes = await GET(
      new Request(`http://localhost/api/projects/${OTHER_PROJECT_ID}/environment`),
      routeContext(OTHER_PROJECT_ID),
    );
    const putRes = await PUT(
      putRequest(OTHER_PROJECT_ID, { content: "SECRET=value" }),
      routeContext(OTHER_PROJECT_ID),
    );

    expect(getRes.status).toBe(404);
    expect(putRes.status).toBe(404);
  });

  it("rejects non-string content", async () => {
    await createOwnedProject();

    const res = await PUT(putRequest(PROJECT_ID, { content: 123 }), routeContext(PROJECT_ID));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "content must be a string" });
  });

  it("rejects content larger than 64 KiB", async () => {
    await createOwnedProject();

    const res = await PUT(
      putRequest(PROJECT_ID, { content: "x".repeat(64 * 1024 + 1) }),
      routeContext(PROJECT_ID),
    );

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: "content is too large" });
  });
});
