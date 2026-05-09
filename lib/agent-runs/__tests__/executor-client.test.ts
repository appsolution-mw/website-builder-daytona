import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  requestProjectQueueDrain,
  requestProjectRunCancel,
} from "../executor-client";
import { enqueueAgentRun } from "../queue";

const mockedAgent = vi.hoisted(() => ({
  cancelProjectRun: vi.fn(async () => undefined),
  createSandbox: vi.fn(),
  destroySandbox: vi.fn(),
  drainProjectQueue: vi.fn(async () => undefined),
  executeProjectRun: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
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
  process.env = { ...originalEnv, WBD_DISABLE_ENV_FILE_LOAD: "1" };
  delete process.env.WORKER_AGENT_HMAC_SECRET;
  delete process.env.WORKER_AGENT_TIMEOUT_MS;
  delete process.env.WORKER_AGENT_URL;
  mockedAgent.createAgentClient.mockReset();
  mockedAgent.drainProjectQueue.mockClear();
  mockedAgent.executeProjectRun.mockClear();
  mockedAgent.cancelProjectRun.mockClear();
  mockedAgent.createAgentClient.mockReturnValue({
    cancelProjectRun: mockedAgent.cancelProjectRun,
    createSandbox: mockedAgent.createSandbox,
    destroySandbox: mockedAgent.destroySandbox,
    drainProjectQueue: mockedAgent.drainProjectQueue,
    executeProjectRun: mockedAgent.executeProjectRun,
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
  await prisma.agentRunEvent.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.commit.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.agentRunAttempt.deleteMany({
    where: { run: { projectId: { in: projects.map((project) => project.id) } } },
  });
  await prisma.agentRun.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.projectQueueState.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.message.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
  });
  await prisma.session.deleteMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
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
      name: `${TEST_PREFIX}worker-${suffix}`,
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

async function createSession(projectId: string): Promise<{ id: string }> {
  return prisma.session.create({
    data: {
      projectId,
      title: "Executor client",
    },
    select: { id: true },
  });
}

async function enqueueProjectRun(input: {
  projectId: string;
  prompt?: string;
}): Promise<{ runId: string; sessionId: string; userId: string }> {
  const session = await createSession(input.projectId);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { ownerId: true },
  });
  const queued = await enqueueAgentRun({
    projectId: input.projectId,
    sessionId: session.id,
    userId: project.ownerId,
    prompt: input.prompt ?? "Build it",
    runtime: "openhands",
    providerSessionId: "provider-1",
    modelId: "model-1",
  });
  return {
    runId: queued.runId,
    sessionId: session.id,
    userId: project.ownerId,
  };
}

function mockSuccessfulExecution(runId: string): void {
  mockedAgent.executeProjectRun.mockImplementationOnce(async (
    _sandboxId: string,
    _request: unknown,
    onEvent: (event: unknown) => void | Promise<void>,
  ) => {
    await onEvent({ type: "agent.chunk", turnId: runId, delta: "Done" });
    await onEvent({
      type: "agent.done",
      turnId: runId,
      durationMs: 10,
      tokensIn: 1,
      tokensOut: 2,
      costUsd: 0,
      exitCode: 0,
    });
  });
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

  it("drains queued project runs through the worker hosting the project sandbox", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    const project = await createProject();
    const { sandboxId } = await createSandbox(project.id);
    const queued = await enqueueProjectRun({
      projectId: project.id,
      prompt: "Build a durable thing",
    });
    mockSuccessfulExecution(queued.runId);

    await requestProjectQueueDrain(project.id);

    expect(mockedAgent.createAgentClient).toHaveBeenCalledWith({
      baseUrl: "http://100.64.0.42:4500",
      hmacSecret: "secret-for-worker-agent",
      timeoutMs: 120_000,
    });
    expect(mockedAgent.executeProjectRun).toHaveBeenCalledWith(
      sandboxId,
      expect.objectContaining({
        projectId: project.id,
        sessionId: queued.sessionId,
        providerSessionId: "provider-1",
        runId: queued.runId,
        prompt: "Build a durable thing",
        runtime: "openhands",
        resumeSession: false,
        modelId: "model-1",
      }),
      expect.any(Function),
    );
    expect(mockedAgent.drainProjectQueue).not.toHaveBeenCalled();
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: queued.runId } }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      prisma.message.findFirstOrThrow({
        where: { projectId: project.id, sessionId: queued.sessionId, role: "AGENT" },
      }),
    ).resolves.toMatchObject({ content: "Done" });
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

  it("uses the configured local worker-agent URL and timeout when present", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    process.env.WORKER_AGENT_URL = "http://127.0.0.1:4500/ignored-path";
    process.env.WORKER_AGENT_TIMEOUT_MS = "45000";
    const project = await createProject();
    await createSandbox(project.id);
    const queued = await enqueueProjectRun({ projectId: project.id });
    mockSuccessfulExecution(queued.runId);

    await requestProjectQueueDrain(project.id);

    expect(mockedAgent.createAgentClient).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:4500",
      hmacSecret: "secret-for-worker-agent",
      timeoutMs: 45_000,
    });
  });

  it("blocks the queued run when a target sandbox exists but worker-agent config is invalid", async () => {
    const project = await createProject();
    await createSandbox(project.id);
    const queued = await enqueueProjectRun({ projectId: project.id });

    await expect(requestProjectQueueDrain(project.id)).resolves.toBeUndefined();
    expect(mockedAgent.createAgentClient).not.toHaveBeenCalled();
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: queued.runId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      blockedReason: expect.stringMatching(/WORKER_AGENT_HMAC_SECRET/),
    });
  });

  it("persists a Commit row when the broker emits git.commit", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    const project = await createProject();
    await createSandbox(project.id);
    const queued = await enqueueProjectRun({ projectId: project.id });
    const committedAt = new Date("2026-05-09T12:00:00.000Z").toISOString();
    const sha = "a".repeat(40);

    mockedAgent.executeProjectRun.mockImplementationOnce(async (
      _sandboxId: string,
      _request: unknown,
      onEvent: (event: unknown) => void | Promise<void>,
    ) => {
      await onEvent({ type: "agent.chunk", turnId: queued.runId, delta: "Done" });
      await onEvent({
        type: "git.commit",
        turnId: queued.runId,
        sha,
        shortSha: "aaaaaaa",
        title: "Add hero",
        bodyMessage: "body",
        filesChanged: 2,
        insertions: 5,
        deletions: 1,
        runtime: "claude-code",
        modelId: "claude-sonnet-4-5",
        authorKind: "AGENT",
        committedAt,
      });
      await onEvent({
        type: "agent.done",
        turnId: queued.runId,
        durationMs: 10,
        tokensIn: 1,
        tokensOut: 2,
        costUsd: 0,
        exitCode: 0,
      });
    });

    await requestProjectQueueDrain(project.id);

    const commit = await prisma.commit.findUniqueOrThrow({
      where: { agentRunId: queued.runId },
    });
    expect(commit).toMatchObject({
      projectId: project.id,
      sessionId: queued.sessionId,
      agentRunId: queued.runId,
      sha,
      shortSha: "aaaaaaa",
      title: "Add hero",
      bodyMessage: "body",
      filesChanged: 2,
      insertions: 5,
      deletions: 1,
      runtime: "CLAUDE_CODE",
      modelId: "claude-sonnet-4-5",
      authorKind: "AGENT",
    });
    expect(commit.createdAt.toISOString()).toBe(committedAt);

    const events = await prisma.agentRunEvent.findMany({
      where: { runId: queued.runId },
      select: { type: true },
    });
    expect(events.map((e) => e.type)).not.toContain("FILE_CHANGED");
  });

  it("does not persist a Commit row when the broker emits git.commit.skipped", async () => {
    process.env.WORKER_AGENT_HMAC_SECRET = "secret-for-worker-agent";
    const project = await createProject();
    await createSandbox(project.id);
    const queued = await enqueueProjectRun({ projectId: project.id });

    mockedAgent.executeProjectRun.mockImplementationOnce(async (
      _sandboxId: string,
      _request: unknown,
      onEvent: (event: unknown) => void | Promise<void>,
    ) => {
      await onEvent({
        type: "git.commit.skipped",
        turnId: queued.runId,
        reason: "no_changes",
      });
      await onEvent({
        type: "agent.done",
        turnId: queued.runId,
        durationMs: 10,
        tokensIn: 1,
        tokensOut: 2,
        costUsd: 0,
        exitCode: 0,
      });
    });

    await requestProjectQueueDrain(project.id);

    const count = await prisma.commit.count({
      where: { agentRunId: queued.runId },
    });
    expect(count).toBe(0);
  });
});
