import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../../../lib/db/client";

vi.mock("@/lib/runtime/broker-rpc", () => ({
  brokerGetCommitFiles: vi.fn(),
}));

import { brokerGetCommitFiles } from "@/lib/runtime/broker-rpc";
import { GET } from "../route";

const DEV_USER_ID = "commit-files-route-user";
const PROJECT_ID = "commit-files-route-project";
const VALID_SHA = "a".repeat(40);

const originalDevUserId = process.env.DEV_USER_ID;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  await prisma.commit.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.message.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.session.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.user.deleteMany({ where: { id: DEV_USER_ID } });
}

async function createOwnedProject(opts: {
  brokerReady: boolean;
  brokerUrl: string | null;
  brokerPreviewToken?: string | null;
}): Promise<void> {
  await prisma.user.create({ data: { id: DEV_USER_ID, email: `${DEV_USER_ID}@example.com` } });
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      ownerId: DEV_USER_ID,
      name: "Commit Files Route Project",
      brokerReady: opts.brokerReady,
      brokerUrl: opts.brokerUrl,
      brokerPreviewToken: opts.brokerPreviewToken ?? null,
    },
  });
}

function routeContext(
  projectId: string,
  sha: string,
): { params: Promise<{ id: string; sha: string }> } {
  return { params: Promise.resolve({ id: projectId, sha }) };
}

describe("GET /api/projects/[id]/commits/[sha]/files", () => {
  afterAll(() => {
    if (originalDevUserId === undefined) {
      delete process.env.DEV_USER_ID;
      return;
    }
    process.env.DEV_USER_ID = originalDevUserId;
  });

  beforeEach(async () => {
    process.env.DEV_USER_ID = DEV_USER_ID;
    vi.mocked(brokerGetCommitFiles).mockReset();
    await cleanDatabase();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns the broker's files payload when the project is ready", async () => {
    await createOwnedProject({
      brokerReady: true,
      brokerUrl: "ws://127.0.0.1:1/?token=t",
      brokerPreviewToken: "t",
    });
    const fixture = {
      files: [
        { path: "a.txt", insertions: 1, deletions: 0 },
        { path: "b.txt", insertions: 2, deletions: 1 },
      ],
    };
    vi.mocked(brokerGetCommitFiles).mockResolvedValueOnce(fixture);

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}/files`,
      ),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fixture);
    expect(brokerGetCommitFiles).toHaveBeenCalledWith(
      { brokerUrl: "ws://127.0.0.1:1/?token=t", brokerPreviewToken: "t" },
      VALID_SHA,
    );
  });

  it("returns 503 when the project's broker is not ready", async () => {
    await createOwnedProject({
      brokerReady: false,
      brokerUrl: "ws://127.0.0.1:1/?token=t",
      brokerPreviewToken: "t",
    });

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}/files`,
      ),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(503);
    expect(brokerGetCommitFiles).not.toHaveBeenCalled();
  });
});
