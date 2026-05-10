import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectFindFirstMock = vi.hoisted(() => vi.fn());
const sessionFindFirstMock = vi.hoisted(() => vi.fn());
const sessionFindManyMock = vi.hoisted(() => vi.fn());
const commitFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({
  createRuntime: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: vi.fn(async () => ({
    ok: true,
    user: { id: "dev-user", email: "dev@example.com", name: "Dev User" },
  })),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findFirst: projectFindFirstMock,
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      findFirst: sessionFindFirstMock,
      findMany: sessionFindManyMock,
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    sessionRuntimeState: {
      create: vi.fn(),
    },
    commit: {
      findMany: commitFindManyMock,
    },
  },
}));

import { GET } from "../route";

describe("GET /api/projects/[id]", () => {
  beforeEach(() => {
    commitFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("includes the latest 20 commits in the project payload", async () => {
    const project = {
      id: "project-with-commits",
      ownerId: "dev-user",
      name: "Project With Commits",
      status: "READY",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      sandboxId: null,
      brokerUrl: null,
      brokerPreviewToken: null,
      previewUrl: null,
    };
    const session = {
      id: "session-1",
      title: "Main chat",
      defaultRuntime: "CLAUDE_CODE",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastMessageAt: new Date("2026-05-03T00:00:00.000Z"),
      runtimeStates: [],
      _count: { messages: 0 },
    };
    projectFindFirstMock.mockResolvedValue(project);
    sessionFindFirstMock.mockResolvedValue(session);
    sessionFindManyMock.mockResolvedValue([session]);
    const allCommits = Array.from({ length: 25 }).map((_, i) => {
      const idx = 24 - i;
      return {
        id: `commit-${idx}`,
        projectId: project.id,
        sessionId: null,
        agentRunId: null,
        sha: idx.toString().padStart(40, "0"),
        shortSha: idx.toString().padStart(7, "0"),
        authorKind: "AGENT",
        runtime: "CLAUDE_CODE",
        modelId: "x",
        title: `c${idx}`,
        bodyMessage: "b",
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        createdAt: new Date(2026, 4, idx + 1),
      };
    });
    commitFindManyMock.mockResolvedValue(allCommits.slice(0, 20));

    const res = await GET(
      new Request("http://localhost/api/projects/project-with-commits"),
      { params: Promise.resolve({ id: "project-with-commits" }) },
    );

    expect(res.status).toBe(200);
    expect(commitFindManyMock).toHaveBeenCalledWith({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    });
    const body = await res.json();
    expect(body.project.commits).toHaveLength(20);
    expect(body.project.commits[0].title).toBe("c24");
    expect(body.project.commits[0].sha).toBe("24".padStart(40, "0"));
    expect(body.project.commits[0].createdAt).toBe(
      new Date(2026, 4, 25).toISOString(),
    );
  });
});
