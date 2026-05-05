import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  enqueueAgentRun,
  getNextQueuedRun,
  markRunFailed,
  markRunStarting,
  markRunSucceeded,
  nextProjectQueueSequence,
  retryAgentRun,
  skipAgentRun,
} from "../queue";

const TEST_PREFIX = "agent-queue-";

afterEach(async (): Promise<void> => {
  await cleanup();
});

async function cleanup(): Promise<void> {
  await prisma.agentRunEvent.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.agentRunAttempt.deleteMany({
    where: { run: { project: { name: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.agentRun.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.projectQueueState.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.message.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.session.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.project.deleteMany({
    where: { name: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

async function createFixture(): Promise<{
  user: { id: string };
  project: { id: string };
  session: { id: string; lastMessageAt: Date };
}> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}user-${suffix}`,
      email: `${TEST_PREFIX}${suffix}@test.local`,
    },
    select: { id: true },
  });
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: `${TEST_PREFIX}project-${suffix}` },
    select: { id: true },
  });
  const session = await prisma.session.create({
    data: { projectId: project.id, title: "Queue" },
    select: { id: true, lastMessageAt: true },
  });
  return { user, project, session };
}

async function enqueueFixtureRun(input?: {
  prompt?: string;
  providerSessionId?: string;
}): Promise<{
  user: { id: string };
  project: { id: string };
  session: { id: string; lastMessageAt: Date };
  runId: string;
  messageId: string;
  queueSequence: number;
}> {
  const fixture = await createFixture();
  const result = await enqueueAgentRun({
    projectId: fixture.project.id,
    sessionId: fixture.session.id,
    userId: fixture.user.id,
    prompt: input?.prompt ?? "Build a queue",
    runtime: "openai-codex",
    providerSessionId: input?.providerSessionId ?? "provider-1",
    modelId: "gpt-test",
  });
  return { ...fixture, ...result };
}

describe("agent run queue transitions", () => {
  it("enqueues runs with project FIFO sequence", async () => {
    const { user, project, session } = await createFixture();

    const first = await enqueueAgentRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "First",
      runtime: "openai-codex",
      providerSessionId: "provider-1",
      modelId: "gpt-test",
    });
    const second = await enqueueAgentRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Second",
      runtime: "openai-codex",
      providerSessionId: "provider-2",
      modelId: "gpt-test",
    });

    expect(first.queueSequence).toBe(1);
    expect(second.queueSequence).toBe(2);
    await expect(nextProjectQueueSequence(project.id)).resolves.toBe(3);
    await expect(getNextQueuedRun(project.id)).resolves.toEqual({
      id: first.runId,
    });

    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: first.messageId } }),
    ).resolves.toMatchObject({
      projectId: project.id,
      sessionId: session.id,
      role: "USER",
      content: "First",
      runtime: "OPENAI_CODEX",
      modelId: "gpt-test",
    });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({ state: "IDLE" });
    expect(
      (
        await prisma.session.findUniqueOrThrow({
          where: { id: session.id },
          select: { lastMessageAt: true },
        })
      ).lastMessageAt.getTime(),
    ).toBeGreaterThanOrEqual(session.lastMessageAt.getTime());
    await expect(
      prisma.agentRunEvent.findMany({
        where: { projectId: project.id },
        orderBy: { sequence: "asc" },
      }),
    ).resolves.toMatchObject([
      {
        runId: first.runId,
        type: "STATUS",
        payload: { status: "QUEUED", queueSequence: 1 },
      },
      {
        runId: second.runId,
        type: "STATUS",
        payload: { status: "QUEUED", queueSequence: 2 },
      },
    ]);
  });

  it("marks a run running and creates attempt 1", async () => {
    const { project, runId } = await enqueueFixtureRun();

    const started = await markRunStarting(runId);

    expect(started.runId).toBe(runId);
    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({
        where: { id: started.attemptId },
      }),
    ).resolves.toMatchObject({
      runId,
      attemptNumber: 1,
      status: "STARTING",
      startedAt: expect.any(Date),
    });
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      status: "RUNNING",
      lastAttemptNumber: 1,
      startedAt: expect.any(Date),
    });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: runId,
      blockedRunId: null,
      blockedAt: null,
    });
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId, attemptId: started.attemptId, type: "STATUS" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "RUNNING", attemptNumber: 1 },
    });
  });

  it("does not create duplicate attempts when starting the same running run again", async () => {
    const { project, runId } = await enqueueFixtureRun();
    const firstStart = await markRunStarting(runId);

    const secondStart = await markRunStarting(runId);

    expect(secondStart).toEqual(firstStart);
    await expect(
      prisma.agentRunAttempt.count({ where: { runId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: runId,
    });
  });

  it("rejects starting another queued run while the project already has an active run", async () => {
    const {
      user,
      project,
      session,
      runId: firstRunId,
    } = await enqueueFixtureRun();
    const secondRun = await enqueueAgentRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Second",
      runtime: "openai-codex",
      providerSessionId: "provider-2",
      modelId: "gpt-test",
    });
    await markRunStarting(firstRunId);

    await expect(markRunStarting(secondRun.runId)).rejects.toThrow(
      "Project already has an active run",
    );
    await expect(
      prisma.agentRunAttempt.count({ where: { runId: secondRun.runId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: firstRunId,
    });
  });

  it("blocks the project queue on failure", async () => {
    const { user, project, session, runId } = await enqueueFixtureRun();
    await enqueueAgentRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Second",
      runtime: "openai-codex",
      providerSessionId: "provider-2",
      modelId: "gpt-test",
    });
    const { attemptId } = await markRunStarting(runId);

    await markRunFailed({
      runId,
      attemptId,
      message: "Worker failed",
    });

    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      finishedAt: expect.any(Date),
      errorMessage: "Worker failed",
      exitCode: 1,
    });
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      finishedAt: expect.any(Date),
      blockedReason: "Worker failed",
    });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "BLOCKED",
      activeRunId: null,
      blockedRunId: runId,
      blockedAt: expect.any(Date),
    });
    await expect(getNextQueuedRun(project.id)).resolves.toBeNull();
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId, attemptId, type: "ERROR" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "FAILED", message: "Worker failed" },
    });
  });

  it("rejects stale success completion when the run is no longer the active project run", async () => {
    const { user, project, session, runId } = await enqueueFixtureRun();
    const secondRun = await enqueueAgentRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Second",
      runtime: "openai-codex",
      providerSessionId: "provider-2",
      modelId: "gpt-test",
    });
    const { attemptId } = await markRunStarting(runId);
    await prisma.projectQueueState.update({
      where: { projectId: project.id },
      data: { activeRunId: secondRun.runId },
    });

    await expect(
      markRunSucceeded({
        runId,
        attemptId,
        agentMessage: "Stale result",
      }),
    ).rejects.toThrow("Run is not the active project run");

    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({ status: "RUNNING" });
    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).resolves.toMatchObject({ status: "STARTING" });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: secondRun.runId,
    });
    await expect(
      prisma.message.count({
        where: {
          projectId: project.id,
          sessionId: session.id,
          role: "AGENT",
        },
      }),
    ).resolves.toBe(0);
  });

  it("rejects stale failure completion after the attempt already finished", async () => {
    const { project, runId } = await enqueueFixtureRun();
    const { attemptId } = await markRunStarting(runId);
    await prisma.agentRunAttempt.update({
      where: { id: attemptId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), exitCode: 0 },
    });

    await expect(
      markRunFailed({
        runId,
        attemptId,
        message: "Late failure",
      }),
    ).rejects.toThrow("Run attempt is not in flight");

    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({ status: "RUNNING", blockedReason: null });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: runId,
      blockedRunId: null,
    });
  });

  it("rejects completion from an older in-flight attempt when a newer attempt exists", async () => {
    const { project, runId } = await enqueueFixtureRun();
    const { attemptId: olderAttemptId } = await markRunStarting(runId);
    const newerAttempt = await prisma.agentRunAttempt.create({
      data: {
        runId,
        attemptNumber: 2,
        status: "RUNNING",
        startedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.agentRun.update({
      where: { id: runId },
      data: { lastAttemptNumber: 2 },
    });

    await expect(
      markRunSucceeded({
        runId,
        attemptId: olderAttemptId,
        agentMessage: "Stale result",
      }),
    ).rejects.toThrow("Run attempt is not current");

    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({ status: "RUNNING" });
    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({
        where: { id: olderAttemptId },
      }),
    ).resolves.toMatchObject({ status: "STARTING", attemptNumber: 1 });
    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({
        where: { id: newerAttempt.id },
      }),
    ).resolves.toMatchObject({ status: "RUNNING", attemptNumber: 2 });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "RUNNING",
      activeRunId: runId,
      blockedRunId: null,
    });
  });

  it("persists final agent message on success", async () => {
    const { project, session, runId } = await enqueueFixtureRun();
    const { attemptId } = await markRunStarting(runId);

    await markRunSucceeded({
      runId,
      attemptId,
      agentMessage: "Done with the build.",
    });

    await expect(
      prisma.agentRunAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      finishedAt: expect.any(Date),
      exitCode: 0,
    });
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      finishedAt: expect.any(Date),
    });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "IDLE",
      activeRunId: null,
    });
    await expect(
      prisma.message.findFirstOrThrow({
        where: {
          projectId: project.id,
          sessionId: session.id,
          role: "AGENT",
        },
      }),
    ).resolves.toMatchObject({
      content: "Done with the build.",
      runtime: "OPENAI_CODEX",
      modelId: "gpt-test",
    });
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId, attemptId, type: "DONE" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "SUCCEEDED" },
    });
  });

  it("keeps the durable enqueue result when queued event append fails", async () => {
    vi.resetModules();
    vi.doMock("../events", () => ({
      appendRunEvent: vi
        .fn()
        .mockRejectedValue(new Error("event store unavailable")),
    }));
    try {
      const { enqueueAgentRun: enqueueWithFailingEvent } = await import(
        "../queue"
      );
      const { user, project, session } = await createFixture();

      const result = await enqueueWithFailingEvent({
        projectId: project.id,
        sessionId: session.id,
        userId: user.id,
        prompt: "Durable prompt",
        runtime: "openai-codex",
        providerSessionId: "provider-event-fail",
        modelId: "gpt-test",
      });

      expect(result.queueSequence).toBe(1);
      await expect(
        prisma.agentRun.count({ where: { projectId: project.id } }),
      ).resolves.toBe(1);
      await expect(
        prisma.message.count({
          where: { projectId: project.id, role: "USER" },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.agentRunEvent.count({ where: { projectId: project.id } }),
      ).resolves.toBe(0);
    } finally {
      vi.doUnmock("../events");
      vi.resetModules();
    }
  });

  it("retries a terminal blocked run without changing its queue position", async () => {
    const { project, runId } = await enqueueFixtureRun();
    const { attemptId } = await markRunStarting(runId);
    await markRunFailed({
      runId,
      attemptId,
      message: "Worker failed",
    });

    await retryAgentRun({ projectId: project.id, runId });

    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      status: "QUEUED",
      queueSequence: 1,
      finishedAt: null,
      blockedReason: null,
      lastAttemptNumber: 1,
    });
    await expect(
      prisma.agentRunAttempt.count({ where: { runId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "IDLE",
      activeRunId: null,
      blockedRunId: null,
      blockedAt: null,
    });
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId, type: "STATUS" },
        orderBy: { sequence: "desc" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "QUEUED", retry: true },
    });
  });

  it("rejects retry for a terminal run that belongs to another project", async () => {
    const { runId } = await enqueueFixtureRun();
    const other = await createFixture();

    await expect(
      retryAgentRun({ projectId: other.project.id, runId }),
    ).rejects.toThrow("Run does not belong to project");
  });

  it("skips only the run blocking the project queue", async () => {
    const { project, runId } = await enqueueFixtureRun();
    const { attemptId } = await markRunStarting(runId);
    await markRunFailed({
      runId,
      attemptId,
      message: "Worker failed",
    });

    await skipAgentRun({ projectId: project.id, runId });

    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      blockedReason: "Worker failed",
    });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "IDLE",
      activeRunId: null,
      blockedRunId: null,
      blockedAt: null,
    });
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId, type: "STATUS" },
        orderBy: { sequence: "desc" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "SKIPPED" },
    });
  });
});
