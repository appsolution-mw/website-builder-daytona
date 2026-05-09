import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../../../../../../lib/db/client";

vi.mock("@/lib/runtime/broker-rpc", () => ({
  brokerGetCommitDiff: vi.fn(),
}));

import { brokerGetCommitDiff } from "@/lib/runtime/broker-rpc";
import { GET } from "../route";

const DEV_USER_ID = "commit-diff-route-user";
const PROJECT_ID = "commit-diff-route-project";
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

async function createReadyProject(): Promise<void> {
  await prisma.user.create({ data: { id: DEV_USER_ID, email: `${DEV_USER_ID}@example.com` } });
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      ownerId: DEV_USER_ID,
      name: "Commit Diff Route Project",
      brokerReady: true,
      brokerUrl: "ws://127.0.0.1:1/?token=t",
      brokerPreviewToken: "t",
    },
  });
}

function routeContext(
  projectId: string,
  sha: string,
): { params: Promise<{ id: string; sha: string }> } {
  return { params: Promise.resolve({ id: projectId, sha }) };
}

describe("GET /api/projects/[id]/commits/[sha]/diff", () => {
  afterAll(() => {
    if (originalDevUserId === undefined) {
      delete process.env.DEV_USER_ID;
      return;
    }
    process.env.DEV_USER_ID = originalDevUserId;
  });

  beforeEach(async () => {
    process.env.DEV_USER_ID = DEV_USER_ID;
    vi.mocked(brokerGetCommitDiff).mockReset();
    await cleanDatabase();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns the broker's diff payload for a valid path", async () => {
    await createReadyProject();
    vi.mocked(brokerGetCommitDiff).mockResolvedValueOnce({ diff: "+hello\n" });

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}/diff?path=a.txt`,
      ),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ diff: "+hello\n" });
    expect(brokerGetCommitDiff).toHaveBeenCalledWith(
      { brokerUrl: "ws://127.0.0.1:1/?token=t", brokerPreviewToken: "t" },
      VALID_SHA,
      "a.txt",
    );
  });

  it("returns 400 when path contains traversal segments", async () => {
    await createReadyProject();

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}/diff?path=${encodeURIComponent("../etc/passwd")}`,
      ),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(400);
    expect(brokerGetCommitDiff).not.toHaveBeenCalled();
  });

  it("returns 400 when path query param is missing", async () => {
    await createReadyProject();

    const res = await GET(
      new Request(
        `http://localhost/api/projects/${PROJECT_ID}/commits/${VALID_SHA}/diff`,
      ),
      routeContext(PROJECT_ID, VALID_SHA),
    );

    expect(res.status).toBe(400);
    expect(brokerGetCommitDiff).not.toHaveBeenCalled();
  });
});
