import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../db/client";
import { createLocalWorkerPoolRuntime } from "../index";

const mockedAgent = vi.hoisted(() => ({
  createAgentClient: vi.fn(),
}));

vi.mock("../agent-client", () => mockedAgent);

const originalEnv = { ...process.env };
const USER_ID = "test-user-local-worker";

async function createProject(): Promise<string> {
  await prisma.user.upsert({
    where: { id: USER_ID },
    create: { id: USER_ID, email: `${USER_ID}@test.local` },
    update: {},
  });
  const project = await prisma.project.create({
    data: {
      name: "local-worker-url-test",
      ownerId: USER_ID,
    },
  });
  return project.id;
}

describe("createLocalWorkerPoolRuntime", () => {
  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      WBD_DISABLE_ENV_FILE_LOAD: "1",
      SANDBOX_IMAGE: "wbd/sandbox:dev",
      WORKER_AGENT_HMAC_SECRET: "x".repeat(32),
      WORKER_AGENT_URL: "http://127.0.0.1:4500",
      WORKER_AGENT_TIMEOUT_MS: "45000",
    };
    mockedAgent.createAgentClient.mockReset();
    mockedAgent.createAgentClient.mockReturnValue({
      createSandbox: vi.fn(async () => ({
        sandboxId: "sandbox-local",
        containerId: "container-local",
        brokerPort: 33001,
        previewPort: 33002,
        status: "spawning",
      })),
      destroySandbox: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({ sandboxId: "sandbox-local", status: "running" })),
      listSandboxes: vi.fn(async () => []),
      health: vi.fn(async () => ({ ok: true })),
    });

    await prisma.sandboxToken.deleteMany({});
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await prisma.sandboxToken.deleteMany({});
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  it("uses WORKER_AGENT_URL for local agent calls and returned project URLs", async () => {
    const runtime = createLocalWorkerPoolRuntime();
    const projectId = await createProject();

    const info = await runtime.spawnProjectSandbox({
      projectId,
      source: { type: "template" },
    });

    expect(mockedAgent.createAgentClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4500",
      hmacSecret: "x".repeat(32),
      timeoutMs: 45000,
    });
    expect(info.brokerUrl).toMatch(/^ws:\/\/127\.0\.0\.1:33001\/\?token=[a-f0-9]{64}$/);
    expect(info.previewUrl).toBe("http://127.0.0.1:33002");
  });
});
