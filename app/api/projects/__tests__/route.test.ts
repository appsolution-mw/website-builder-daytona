import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnProjectSandboxMock = vi.hoisted(() => vi.fn());
const projectEnvironmentFindUniqueMock = vi.hoisted(() => vi.fn());
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
      findUnique: projectEnvironmentFindUniqueMock,
    },
  },
}));

import { POST } from "../route";

const originalRuntimeMode = process.env.RUNTIME_MODE;

describe("POST /api/projects", () => {
  afterEach(() => {
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
    projectEnvironmentFindUniqueMock.mockResolvedValue({ content: projectEnv });
    spawnProjectSandboxMock.mockResolvedValue({
      sandboxId: "sandbox-1",
      brokerUrl: "ws://localhost:4000",
      brokerPreviewToken: "token",
      previewUrl: "http://localhost:3000",
    });
    projectUpdateMock.mockResolvedValue({ ...project, status: "RUNNING" });

    const res = await POST(new NextRequest("http://localhost/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project With Env" }),
    }));

    expect(res.status).toBe(201);
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
