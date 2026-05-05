import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  enqueueAgentRun,
  getNextQueuedRun,
  markRunFailed,
  markRunStarting,
  markRunSucceeded,
  nextProjectQueueSequence,
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
});
