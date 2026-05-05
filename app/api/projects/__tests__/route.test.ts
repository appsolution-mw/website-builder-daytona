import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "@/lib/runtime/worker-pool/types";

const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const projectEnvironmentUpsertMock = vi.hoisted(() => vi.fn());
const projectCreateMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());
const githubRepositoryFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const createInstallationAccessTokenMock = vi.hoisted(() => vi.fn());
const getEffectiveAgentConfigMock = vi.hoisted(() => vi.fn());
const materializeOpenHandsFilesMock = vi.hoisted(() => vi.fn());
const ensureDefaultWorkspaceForUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: vi.fn(async () => ({
    ok: true,
    user: { id: "dev-user", email: "dev@example.com", name: "Dev User" },
  })),
}));

vi.mock("@/lib/runtime", () => ({
  createRuntime: () => ({
    spawnProjectSandbox: spawnProjectSandboxMock,
  }),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $transaction: transactionMock,
    gitHubRepository: {
      findFirst: githubRepositoryFindFirstMock,
    },
    project: {
      create: projectCreateMock,
      findMany: vi.fn(),
      update: projectUpdateMock,
    },
    projectEnvironment: {
      upsert: projectEnvironmentUpsertMock,
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

vi.mock("@/lib/workspaces/access", () => ({
  ensureDefaultWorkspaceForUser: ensureDefaultWorkspaceForUserMock,
}));

import { POST } from "../route";

const originalRuntimeMode = process.env.RUNTIME_MODE;
type TransactionMockCallback = (tx: {
  project: { create: typeof projectCreateMock };
  projectEnvironment: { upsert: typeof projectEnvironmentUpsertMock };
}) => Promise<unknown>;

describe("POST /api/projects", () => {
  beforeEach(() => {
    transactionMock.mockImplementation((callback: TransactionMockCallback) => callback({
      project: { create: projectCreateMock },
      projectEnvironment: { upsert: projectEnvironmentUpsertMock },
    }));
    getEffectiveAgentConfigMock.mockResolvedValue({ agentsMd: "# AGENTS.md\n", agentsMode: "EXTEND", skills: [], agents: [] });
    materializeOpenHandsFilesMock.mockReturnValue([{ path: "AGENTS.md", content: "# AGENTS.md\n" }]);
    ensureDefaultWorkspaceForUserMock.mockResolvedValue({ id: "workspace-1", name: "Dev User" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    if (originalRuntimeMode === undefined) {
      delete process.env.RUNTIME_MODE;
      return;
    }

    process.env.RUNTIME_MODE = originalRuntimeMode;
  });

  it("creates the project and initial env content in one transaction", async () => {
    const project = {
      id: "project-with-env",
      name: "Project With Env",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    const projectEnv = "NEXT_PUBLIC_LABEL=Host\nSECRET_VALUE=hidden\n";
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    projectEnvironmentUpsertMock.mockResolvedValue({ content: projectEnv });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-1",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "token",
      previewUrl: "http://localhost:3000",
    });
    projectUpdateMock.mockResolvedValue({ ...project, status: "RUNNING" });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project With Env", environmentContent: projectEnv }),
    }));

    expect(res.status).toBe(201);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(ensureDefaultWorkspaceForUserMock).toHaveBeenCalledWith({
      id: "dev-user",
      email: "dev@example.com",
      name: "Dev User",
    });
    expect(projectCreateMock).toHaveBeenCalledTimes(1);
    expect(projectCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "workspace-1" }),
    }));
    expect(projectEnvironmentUpsertMock).toHaveBeenCalledTimes(1);
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-with-env",
      projectEnvContent: projectEnv,
    }));
  });

  it("does not spawn or mark a project running when initial env persistence fails", async () => {
    const project = {
      id: "project-with-env-failure",
      name: "Project With Env Failure",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    projectEnvironmentUpsertMock.mockRejectedValue(new Error("env persistence failed"));

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Project With Env Failure",
        environmentContent: "SECRET_VALUE=hidden\n",
      }),
    }));

    expect(res.status).toBe(500);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(spawnProjectSandboxMock).not.toHaveBeenCalled();
    expect(projectUpdateMock).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RUNNING" }),
    }));
  });

  it("sanitizes spawn failure details in the response and stored provisioning error", async () => {
    const project = {
      id: "project-spawn-fails",
      name: "Project Spawn Fails",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    const leakedSecret = "SECRET_VALUE=hidden";
    const leakedBase64 = "U0VDUkVUX1ZBTFVFPWhpZGRlbgo=";
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    projectEnvironmentUpsertMock.mockResolvedValue({ content: `${leakedSecret}\n` });
    spawnProjectSandboxMock.mockRejectedValue(
      new Error(`runtime spawn failed with ${leakedSecret} ${leakedBase64}`),
    );
    projectUpdateMock.mockResolvedValue({
      ...project,
      status: "DESTROYED",
      provisioningError: "sandbox provisioning failed",
    });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Project Spawn Fails",
        environmentContent: `${leakedSecret}\n`,
      }),
    }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(projectUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "DESTROYED",
        provisioningError: "sandbox provisioning failed",
      },
    }));
    expect(json).toMatchObject({
      error: "provisioning failed",
      message: "sandbox provisioning failed",
    });
    expect(JSON.stringify(json)).not.toContain(leakedSecret);
    expect(JSON.stringify(json)).not.toContain(leakedBase64);
  });

  it("stores a safe actionable message when the worker-agent cannot find the sandbox image", async () => {
    const project = {
      id: "project-image-missing",
      name: "Project Image Missing",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    spawnProjectSandboxMock.mockRejectedValue(
      new AgentError(422, "image-not-found", "POST /sandboxes -> 422 image-not-found"),
    );
    projectUpdateMock.mockResolvedValue({
      ...project,
      status: "DESTROYED",
      provisioningError: "sandbox image not found",
    });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project Image Missing" }),
    }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(projectUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        status: "DESTROYED",
        provisioningError: "sandbox image not found",
      },
    }));
    expect(json).toMatchObject({
      error: "provisioning failed",
      message: "sandbox image not found",
    });
  });

  it("passes saved project env content when spawning the sandbox", async () => {
    const project = {
      id: "project-with-env",
      name: "Project With Env",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    const projectEnv = "NEXT_PUBLIC_LABEL=Host\nSECRET_VALUE=hidden\n";
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    projectEnvironmentUpsertMock.mockResolvedValue({
      content: projectEnv,
      updatedAt: new Date("2026-05-03T00:00:00.000Z"),
    });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-1",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "token",
      previewUrl: "http://localhost:3000",
    });
    projectUpdateMock.mockResolvedValue({ ...project, status: "RUNNING" });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project With Env", environmentContent: projectEnv }),
    }));

    expect(res.status).toBe(201);
    expect(projectEnvironmentUpsertMock).toHaveBeenCalledWith({
      where: { projectId: "project-with-env" },
      create: { projectId: "project-with-env", content: projectEnv },
      update: { content: projectEnv },
      select: { content: true },
    });
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-with-env",
      projectEnvContent: projectEnv,
    }));
  });

  it("passes materialized OpenHands files when spawning the sandbox", async () => {
    const project = {
      id: "project-openhands",
      name: "Project OpenHands",
      status: "PROVISIONING",
      agentRuntime: "OPENHANDS",
      desiredRuntime: "OPENHANDS",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    const openhandsFiles = [
      { path: "AGENTS.md", content: "# Effective\n" },
      { path: ".agents/skills/ui/SKILL.md", content: "---\nname: ui\n---\n" },
    ];
    process.env.RUNTIME_MODE = "worker-pool-local";
    projectCreateMock.mockResolvedValue(project);
    materializeOpenHandsFilesMock.mockReturnValue(openhandsFiles);
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-1",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "token",
      previewUrl: "http://localhost:3000",
    });
    projectUpdateMock.mockResolvedValue({ ...project, status: "RUNNING" });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project OpenHands", runtime: "openhands" }),
    }));

    expect(res.status).toBe(201);
    expect(getEffectiveAgentConfigMock).toHaveBeenCalledWith("project-openhands");
    expect(materializeOpenHandsFilesMock).toHaveBeenCalled();
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-openhands",
      openhandsFiles,
    }));
  });

  it("stores GitHub source metadata and spawns with an installation token", async () => {
    const project = {
      id: "project-from-github",
      name: "Project From GitHub",
      status: "PROVISIONING",
      agentRuntime: "CLAUDE_CODE",
      desiredRuntime: "CLAUDE_CODE",
      runtimeSwitchStatus: "IDLE",
      runtimeGeneration: 0,
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      lastActive: new Date("2026-05-03T00:00:00.000Z"),
      brokerUrl: null,
      previewUrl: null,
      sessions: [],
    };
    process.env.RUNTIME_MODE = "worker-pool-local";
    githubRepositoryFindFirstMock.mockResolvedValue({
      id: "repo_record_1",
      installationId: "installation_record_1",
      ownerLogin: "octo",
      name: "hello-world",
      installation: {
        installationId: 123n,
      },
    });
    createInstallationAccessTokenMock.mockResolvedValue({
      token: "installation-token",
      expires_at: "2026-05-04T01:00:00Z",
    });
    projectCreateMock.mockResolvedValue(project);
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-1",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "token",
      previewUrl: "http://localhost:3000",
    });
    projectUpdateMock.mockResolvedValue({ ...project, status: "RUNNING" });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Project From GitHub",
        sourceType: "github",
        githubRepositoryId: "repo_record_1",
        githubBaseBranch: "main",
      }),
    }));

    expect(res.status).toBe(201);
    expect(githubRepositoryFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "repo_record_1",
        installation: { ownerId: expect.any(String) },
      },
      include: { installation: true },
    });
    expect(projectCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceType: "GITHUB",
        githubInstallationId: "installation_record_1",
        githubRepositoryId: "repo_record_1",
        githubOwner: "octo",
        githubRepo: "hello-world",
        githubBaseBranch: "main",
      }),
    }));
    expect(spawnProjectSandboxMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-from-github",
      source: {
        type: "github",
        installationId: "123",
        owner: "octo",
        repo: "hello-world",
        branch: "main",
        token: "installation-token",
      },
    }));
  });

  it("rejects GitHub project creation when the repository is not owned by the current user", async () => {
    process.env.RUNTIME_MODE = "worker-pool-local";
    githubRepositoryFindFirstMock.mockResolvedValue(null);

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Missing Repo",
        sourceType: "github",
        githubRepositoryId: "repo_missing",
      }),
    }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "repository not found" });
    expect(projectCreateMock).not.toHaveBeenCalled();
    expect(spawnProjectSandboxMock).not.toHaveBeenCalled();
  });

  it("rejects non-string initial env content", async () => {
    process.env.RUNTIME_MODE = "worker-pool-local";

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Invalid Env", environmentContent: 42 }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "environmentContent must be a string" });
    expect(projectCreateMock).not.toHaveBeenCalled();
    expect(projectEnvironmentUpsertMock).not.toHaveBeenCalled();
    expect(spawnProjectSandboxMock).not.toHaveBeenCalled();
  });

  it("rejects oversized initial env content", async () => {
    process.env.RUNTIME_MODE = "worker-pool-local";
    const oversizedContent = "a".repeat((64 * 1024) + 1);

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Oversized Env", environmentContent: oversizedContent }),
    }));

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: "content is too large" });
    expect(projectCreateMock).not.toHaveBeenCalled();
    expect(projectEnvironmentUpsertMock).not.toHaveBeenCalled();
    expect(spawnProjectSandboxMock).not.toHaveBeenCalled();
  });
});
