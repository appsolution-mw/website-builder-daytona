import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeError } from "@/lib/runtime/errors";

const destroyProjectSandboxMock = vi.hoisted(() => vi.fn());
const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const createRuntimeMock = vi.hoisted(() => vi.fn());
const projectFindFirstMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());
const projectEnvironmentFindUniqueMock = vi.hoisted(() => vi.fn());
const createInstallationAccessTokenMock = vi.hoisted(() => vi.fn());
const getEffectiveAgentConfigMock = vi.hoisted(() => vi.fn());
const materializeOpenHandsFilesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: vi.fn(async () => ({
    ok: true,
    user: { id: "dev-user" },
  })),
}));

vi.mock("@/lib/runtime", () => ({
  createRuntime: createRuntimeMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findFirst: projectFindFirstMock,
      update: projectUpdateMock,
    },
    projectEnvironment: {
      findUnique: projectEnvironmentFindUniqueMock,
    },
  },
}));

vi.mock("@/lib/github/app", () => ({
  createInstallationAccessToken: createInstallationAccessTokenMock,
}));

vi.mock("@/lib/agent-config/db", () => ({
  getEffectiveAgentConfig: getEffectiveAgentConfigMock,
}));

vi.mock("@/lib/agent-config/materialize", () => ({
  materializeOpenHandsFiles: materializeOpenHandsFilesMock,
}));

import { POST } from "../route";

describe("POST /api/projects/[id]/restart", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    getEffectiveAgentConfigMock.mockResolvedValue({ agentsMd: "# AGENTS.md\n", agentsMode: "EXTEND", skills: [], agents: [] });
    materializeOpenHandsFilesMock.mockReturnValue([{ path: "AGENTS.md", content: "# AGENTS.md\n" }]);
  });

  it("destroys and respawns a template sandbox with saved environment content", async () => {
    const project = {
      id: "project-1",
      ownerId: "dev-user",
      name: "Restart Me",
      status: "RUNNING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-04T00:00:00.000Z"),
      lastActive: new Date("2026-05-04T00:00:00.000Z"),
      sandboxId: "sandbox-old",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "old-token",
      previewUrl: "http://localhost:3000",
      provisioningError: null,
      sourceType: "TEMPLATE",
      githubOwner: null,
      githubRepo: null,
      githubBaseBranch: null,
      githubInstallation: null,
    };
    const projectEnv = "NEXT_PUBLIC_LABEL=Restarted\nSECRET_VALUE=hidden\n";
    const runtime = {
      destroyProjectSandbox: destroyProjectSandboxMock,
      spawnProjectSandbox: spawnProjectSandboxMock,
    };
    createRuntimeMock.mockReturnValue(runtime);
    projectFindFirstMock.mockResolvedValue(project);
    projectEnvironmentFindUniqueMock.mockResolvedValue({ content: projectEnv });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });
    projectUpdateMock.mockResolvedValue({
      ...project,
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });

    const res = await POST(new Request("http://localhost/api/projects/project-1/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(res.status).toBe(200);
    expect(destroyProjectSandboxMock).toHaveBeenCalledWith("sandbox-old");
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith({
      projectId: "project-1",
      source: { type: "template" },
      projectEnvContent: projectEnv,
      openhandsFiles: [{ path: "AGENTS.md", content: "# AGENTS.md\n" }],
    });
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { brokerReady: false, brokerReadyAt: null },
    });
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        status: "RUNNING",
        sandboxId: "sandbox-new",
        brokerUrl: "ws://localhost:4001",
        brokerPreviewToken: "new-token",
        previewUrl: "http://localhost:3001",
        provisioningError: null,
        brokerReady: false,
        brokerReadyAt: null,
      },
    });
  });

  it("destroys the new sandbox when persisting restarted project state fails", async () => {
    const project = {
      id: "project-update-fails",
      ownerId: "dev-user",
      name: "Restart Update Fails",
      status: "RUNNING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-04T00:00:00.000Z"),
      lastActive: new Date("2026-05-04T00:00:00.000Z"),
      sandboxId: "sandbox-old",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "old-token",
      previewUrl: "http://localhost:3000",
      provisioningError: null,
      sourceType: "TEMPLATE",
      githubOwner: null,
      githubRepo: null,
      githubBaseBranch: null,
      githubInstallation: null,
    };
    createRuntimeMock.mockReturnValue({
      destroyProjectSandbox: destroyProjectSandboxMock,
      spawnProjectSandbox: spawnProjectSandboxMock,
    });
    projectFindFirstMock.mockResolvedValue(project);
    projectEnvironmentFindUniqueMock.mockResolvedValue(null);
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });
    projectUpdateMock
      .mockResolvedValueOnce({ ...project, brokerReady: false, brokerReadyAt: null })
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({
        ...project,
        status: "DESTROYED",
        brokerUrl: null,
        brokerPreviewToken: null,
        previewUrl: null,
        provisioningError: "sandbox restart failed",
      });

    const res = await POST(new Request("http://localhost/api/projects/project-update-fails/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-update-fails" }),
    });

    expect(res.status).toBe(500);
    expect(destroyProjectSandboxMock).toHaveBeenCalledWith("sandbox-old");
    expect(destroyProjectSandboxMock).toHaveBeenCalledWith("sandbox-new");
    await expect(res.json()).resolves.toMatchObject({
      error: "restart failed",
      message: "sandbox restart failed",
    });
  });

  it("respawns a GitHub sandbox from the stored source with a fresh installation token", async () => {
    const project = {
      id: "project-github",
      ownerId: "dev-user",
      name: "GitHub Restart",
      status: "RUNNING",
      sandboxId: "sandbox-old",
      sourceType: "GITHUB",
      githubOwner: "octo",
      githubRepo: "hello-world",
      githubBaseBranch: "main",
      githubInstallation: { installationId: 123n },
    };
    const runtime = {
      destroyProjectSandbox: destroyProjectSandboxMock,
      spawnProjectSandbox: spawnProjectSandboxMock,
    };
    createRuntimeMock.mockReturnValue(runtime);
    projectFindFirstMock.mockResolvedValue(project);
    projectEnvironmentFindUniqueMock.mockResolvedValue(null);
    createInstallationAccessTokenMock.mockResolvedValue({
      token: "installation-token",
      expires_at: "2026-05-04T01:00:00Z",
    });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });
    projectUpdateMock.mockResolvedValue({
      id: project.id,
      name: project.name,
      status: "RUNNING",
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });

    const res = await POST(new Request("http://localhost/api/projects/project-github/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-github" }),
    });

    expect(res.status).toBe(200);
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith(123n);
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith({
      projectId: "project-github",
      source: {
        type: "github",
        installationId: "123",
        owner: "octo",
        repo: "hello-world",
        branch: "main",
        token: "installation-token",
      },
      projectEnvContent: undefined,
      openhandsFiles: [{ path: "AGENTS.md", content: "# AGENTS.md\n" }],
    });
  });

  it("materializes the effective OpenHands config for restart", async () => {
    const openhandsFiles = [
      { path: "AGENTS.md", content: "# Effective\n" },
      { path: ".agents/agents/reviewer.md", content: "---\nname: reviewer\n---\n" },
    ];
    const runtime = {
      destroyProjectSandbox: destroyProjectSandboxMock,
      spawnProjectSandbox: spawnProjectSandboxMock,
    };
    createRuntimeMock.mockReturnValue(runtime);
    projectFindFirstMock.mockResolvedValue({
      id: "project-openhands",
      status: "RUNNING",
      sandboxId: "sandbox-old",
      sourceType: "TEMPLATE",
      githubOwner: null,
      githubRepo: null,
      githubBaseBranch: null,
      githubInstallation: null,
    });
    projectEnvironmentFindUniqueMock.mockResolvedValue(null);
    materializeOpenHandsFilesMock.mockReturnValue(openhandsFiles);
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-new",
      brokerUrl: "ws://localhost:4001",
      brokerPreviewToken: "new-token",
      previewUrl: "http://localhost:3001",
    });
    projectUpdateMock.mockResolvedValue({
      id: "project-openhands",
      status: "RUNNING",
      sandboxId: "sandbox-new",
    });

    const res = await POST(new Request("http://localhost/api/projects/project-openhands/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-openhands" }),
    });

    expect(res.status).toBe(200);
    expect(getEffectiveAgentConfigMock).toHaveBeenCalledWith("project-openhands");
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-openhands",
      openhandsFiles,
    }));
  });

  it("rejects restart while the project is provisioning", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: "project-provisioning",
      status: "PROVISIONING",
      sandboxId: null,
      sourceType: "TEMPLATE",
      githubOwner: null,
      githubRepo: null,
      githubBaseBranch: null,
      githubInstallation: null,
    });

    const res = await POST(new Request("http://localhost/api/projects/project-provisioning/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-provisioning" }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "project is provisioning" });
    expect(destroyProjectSandboxMock).not.toHaveBeenCalled();
    expect(spawnProjectSandboxMock).not.toHaveBeenCalled();
  });

  it("returns 409 when no worker capacity is available during restart", async () => {
    const project = {
      id: "project-no-capacity",
      status: "DESTROYED",
      sandboxId: null,
      sourceType: "TEMPLATE",
      githubOwner: null,
      githubRepo: null,
      githubBaseBranch: null,
      githubInstallation: null,
    };
    const runtime = {
      destroyProjectSandbox: destroyProjectSandboxMock,
      spawnProjectSandbox: spawnProjectSandboxMock,
    };
    createRuntimeMock.mockReturnValue(runtime);
    projectFindFirstMock.mockResolvedValue(project);
    projectEnvironmentFindUniqueMock.mockResolvedValue(null);
    spawnProjectSandboxMock.mockRejectedValue(
      new RuntimeError("NO_WORKER_CAPACITY", "No ready worker has a free project slot"),
    );
    projectUpdateMock.mockResolvedValue({
      ...project,
      provisioningError: "No ready worker has a free project slot",
    });

    const res = await POST(new Request("http://localhost/api/projects/project-no-capacity/restart", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "project-no-capacity" }),
    });

    expect(res.status).toBe(409);
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: "project-no-capacity" },
      data: {
        status: "DESTROYED",
        brokerUrl: null,
        brokerPreviewToken: null,
        previewUrl: null,
        brokerReady: false,
        brokerReadyAt: null,
        provisioningError: "No ready worker has a free project slot",
      },
    });
    await expect(res.json()).resolves.toMatchObject({
      error: "no worker capacity",
      message: "No ready worker has a free project slot",
    });
  });
});
