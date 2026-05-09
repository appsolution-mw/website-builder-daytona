import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const projectEnvironmentFindUniqueMock = vi.hoisted(() => vi.fn());
const projectFindFirstMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());
const sessionFindFirstMock = vi.hoisted(() => vi.fn());
const sessionFindManyMock = vi.hoisted(() => vi.fn());
const commitFindManyMock = vi.hoisted(() => vi.fn());
const getEffectiveAgentConfigMock = vi.hoisted(() => vi.fn());
const materializeOpenHandsFilesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({
  createRuntime: vi.fn(),
  createDaytonaRuntime: () => ({
    spawnProjectSandbox: spawnProjectSandboxMock,
  }),
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
      update: projectUpdateMock,
    },
    projectEnvironment: {
      findUnique: projectEnvironmentFindUniqueMock,
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

vi.mock("@/lib/agent-config/db", () => ({
  getEffectiveAgentConfig: getEffectiveAgentConfigMock,
}));

vi.mock("@/lib/agent-config/materialize", () => ({
  materializeOpenHandsFiles: materializeOpenHandsFilesMock,
}));

import { GET } from "../route";

describe("GET /api/projects/[id]", () => {
  beforeEach(() => {
    getEffectiveAgentConfigMock.mockResolvedValue({ agentsMd: "# AGENTS.md\n", agentsMode: "EXTEND", skills: [], agents: [] });
    materializeOpenHandsFilesMock.mockReturnValue([{ path: "AGENTS.md", content: "# AGENTS.md\n" }]);
    commitFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes saved project env content when respawning a fake sandbox", async () => {
    const project = {
      id: "project-with-env",
      ownerId: "dev-user",
      name: "Project With Env",
      status: "RUNNING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      sandboxId: "fake-stale",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "old-token",
      previewUrl: "http://localhost:3000",
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
    const projectEnv = "NEXT_PUBLIC_LABEL=Fake\nSECRET_VALUE=hidden\n";
    projectFindFirstMock.mockResolvedValue(project);
    projectEnvironmentFindUniqueMock.mockResolvedValue({ content: projectEnv });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "fake-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });
    projectUpdateMock.mockResolvedValue({ ...project, sandboxId: "fake-new" });
    sessionFindFirstMock.mockResolvedValue(session);
    sessionFindManyMock.mockResolvedValue([session]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 503 })));

    const res = await GET(new Request("http://localhost/api/projects/project-with-env"), {
      params: Promise.resolve({ id: "project-with-env" }),
    });

    expect(res.status).toBe(200);
    expect(projectEnvironmentFindUniqueMock).toHaveBeenCalledWith({
      where: { projectId: "project-with-env" },
      select: { content: true },
    });
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-with-env",
      projectEnvContent: projectEnv,
      openhandsFiles: [{ path: "AGENTS.md", content: "# AGENTS.md\n" }],
    }));
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
    // 25 commits, newest first (matches orderBy desc)
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
    // Route uses take: 20 — return the latest 20
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
