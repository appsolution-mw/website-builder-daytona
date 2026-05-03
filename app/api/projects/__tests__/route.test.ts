import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const projectEnvironmentUpsertMock = vi.hoisted(() => vi.fn());
const projectCreateMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/runtime", () => ({
  createRuntime: () => ({
    spawnProjectSandbox: spawnProjectSandboxMock,
  }),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
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

import { POST } from "../route";

const originalRuntimeMode = process.env.RUNTIME_MODE;

describe("POST /api/projects", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    if (originalRuntimeMode === undefined) {
      delete process.env.RUNTIME_MODE;
      return;
    }

    process.env.RUNTIME_MODE = originalRuntimeMode;
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
