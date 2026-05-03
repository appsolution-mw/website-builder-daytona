import { afterEach, describe, expect, it, vi } from "vitest";

const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const projectEnvironmentFindUniqueMock = vi.hoisted(() => vi.fn());
const projectFindFirstMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());
const sessionFindFirstMock = vi.hoisted(() => vi.fn());
const sessionFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({
  createRuntime: vi.fn(),
  createDaytonaRuntime: () => ({
    spawnProjectSandbox: spawnProjectSandboxMock,
  }),
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
  },
}));

import { GET } from "../route";

describe("GET /api/projects/[id]", () => {
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
      daytonaSandboxId: "fake-stale",
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
    projectUpdateMock.mockResolvedValue({ ...project, daytonaSandboxId: "fake-new" });
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
    }));
  });
});
