import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  requestProjectQueueDrain,
  requestProjectRunCancel,
} from "../executor-client";

const mockedAgent = vi.hoisted(() => ({
  cancelProjectRun: vi.fn(async () => undefined),
  createSandbox: vi.fn(),
  destroySandbox: vi.fn(),
  drainProjectQueue: vi.fn(async () => undefined),
  getStatus: vi.fn(),
  health: vi.fn(),
  listSandboxes: vi.fn(),
  createAgentClient: vi.fn(),
}));

vi.mock("@/lib/runtime/worker-pool/agent-client", () => ({
  createAgentClient: mockedAgent.createAgentClient,
}));

const TEST_PREFIX = "executor-client-";
const originalEnv = { ...process.env };

beforeEach(async (): Promise<void> => {
  process.env = { ...originalEnv };
  delete process.env.WORKER_AGENT_HMAC_SECRET;
  mockedAgent.createAgentClient.mockReset();
  mockedAgent.drainProjectQueue.mockClear();
  mockedAgent.cancelProjectRun.mockClear();
  mockedAgent.createAgentClient.mockReturnValue({
    cancelProjectRun: mockedAgent.cancelProjectRun,
    createSandbox: mockedAgent.createSandbox,
    destroySandbox: mockedAgent.destroySandbox,
    drainProjectQueue: mockedAgent.drainProjectQueue,
    getStatus: mockedAgent.getStatus,
    health: mockedAgent.health,
    listSandboxes: mockedAgent.listSandboxes,
  });
  await cleanup();
});

afterEach(async (): Promise<void> => {
  process.env = { ...originalEnv };
  await cleanup();
});

async function cleanup(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  await prisma.workerSandbox.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.worker.deleteMany({
    where: { providerVmId: { startsWith: TEST_PREFIX } },
  });
  await prisma.project.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function createProject(): Promise<{ id: string }> {
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}user-${suffix}`,
      email: `${TEST_PREFIX}${suffix}@test.local`,
    },
    select: { id: true },
  });
  return prisma.project.create({
    data: {
      name: `${TEST_PREFIX}project-${suffix}`,
      ownerId: user.id,
    },
    select: { id: true },
  });
}

async function createSandbox(projectId: string): Promise<{ sandboxId: string }> {
  const suffix = crypto.randomUUID();
  const worker = await prisma.worker.create({
    data: {
      tailscaleHostname: `${TEST_PREFIX}worker-${suffix}`,
      tailscaleIp: "100.64.0.42",
      provider: "fake",
      providerVmId: `${TEST_PREFIX}vm-${suffix}`,
      region: "test",
      capacity: 1,
      status: "READY",
    },
    select: { id: true },
  });
  const sandbox = await prisma.workerSandbox.create({
    data: {
      workerId: worker.id,
      projectId,
      containerId: `${TEST_PREFIX}container-${suffix}`,
      brokerPort: 33001,
      previewPort: 33002,
      status: "RUNNING",
    },
    select: { id: true },
  });
  return { sandboxId: sandbox.id };
}

describe("executor-client", () => {
  it("no-ops queue drain and run cancel when the project has no worker sandbox", async () => {
    const project = await createProject();

    await expect(requestProjectQueueDrain(project.id)).resolves.toBeUndefined();
    await expect(
      requestProjectRunCancel(project.id, "run-1"),
    ).resolves.toBeUndefined();

    expect(mockedAgent.createAgentClient).not.toHaveBeenCalled();
    expect(mockedAgent.drainProjectQueue).not.toHaveBeenCalled();
    expect(mockedAgent.cancelProjectRun).not.toHaveBeenCalled();
  });

  it("sends a queue drain command to the worker hosting the project sandbox", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    const project = await createProject();
    const { sandboxId } = await createSandbox(project.id);

    await requestProjectQueueDrain(project.id);

    expect(mockedAgent.createAgentClient).toHaveBeenCalledWith({
      baseUrl: "http://100.64.0.42:4500",
      hmacSecret: "secret-for-worker-agent",
    });
    expect(mockedAgent.drainProjectQueue).toHaveBeenCalledWith(
      sandboxId,
      project.id,
    );
  });

  it("sends a run cancel command to the worker hosting the project sandbox", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    const project = await createProject();
    const { sandboxId } = await createSandbox(project.id);

    await requestProjectRunCancel(project.id, "run-1");

    expect(mockedAgent.cancelProjectRun).toHaveBeenCalledWith(
      sandboxId,
      project.id,
      "run-1",
    );
  });

  it("throws for a missing worker-agent secret only when a command has a target sandbox", async () => {
    const project = await createProject();
    await createSandbox(project.id);

    await expect(requestProjectQueueDrain(project.id)).rejects.toThrow(
      "WORKER_AGENT_HMAC_SECRET is not set",
    );
    expect(mockedAgent.createAgentClient).not.toHaveBeenCalled();
  });
});
