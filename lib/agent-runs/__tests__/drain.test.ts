import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { drainProjectQueue, type RunExecutionAdapter } from "../drain";
import { enqueueAgentRun, skipAgentRun } from "../queue";

const TEST_PREFIX = "agent-drain-";

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
  session: { id: string };
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
    data: { projectId: project.id, title: "Drain" },
    select: { id: true },
  });
  return { user, project, session };
}

async function enqueueFixtureRun(input: {
  projectId: string;
  sessionId: string;
  userId: string;
  prompt: string;
  providerSessionId: string;
}): Promise<{ runId: string; queueSequence: number }> {
  return enqueueAgentRun({
    projectId: input.projectId,
    sessionId: input.sessionId,
    userId: input.userId,
    prompt: input.prompt,
    runtime: "openai-codex",
    providerSessionId: input.providerSessionId,
    modelId: "gpt-test",
  });
}

describe("drainProjectQueue", () => {
  it("runs queued items in FIFO order", async () => {
    const { user, project, session } = await createFixture();
    const first = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "First",
      providerSessionId: "provider-1",
    });
    const second = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Second",
      providerSessionId: "provider-2",
    });
    const third = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Third",
      providerSessionId: "provider-3",
    });
    const executions: string[] = [];
    const execute: RunExecutionAdapter = async ({ runId }) => {
      executions.push(runId);
      return { ok: true, agentMessage: `Done ${executions.length}` };
    };

    const result = await drainProjectQueue({
      projectId: project.id,
      execute,
    });

    expect(result).toEqual({ started: 3, stoppedReason: "empty" });
    expect(executions).toEqual([first.runId, second.runId, third.runId]);
    await expect(
      prisma.agentRun.findMany({
        where: { projectId: project.id },
        select: { id: true, status: true, queueSequence: true },
        orderBy: { queueSequence: "asc" },
      }),
    ).resolves.toEqual([
      { id: first.runId, status: "SUCCEEDED", queueSequence: 1 },
      { id: second.runId, status: "SUCCEEDED", queueSequence: 2 },
      { id: third.runId, status: "SUCCEEDED", queueSequence: 3 },
    ]);
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({ state: "IDLE", activeRunId: null });
  });

  it("stops when a run fails and leaves later runs queued", async () => {
    const { user, project, session } = await createFixture();
    const failed = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Fail",
      providerSessionId: "provider-1",
    });
    const later = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Later",
      providerSessionId: "provider-2",
    });
    const executions: string[] = [];

    const result = await drainProjectQueue({
      projectId: project.id,
      execute: async ({ runId }) => {
        executions.push(runId);
        return { ok: false, message: "Worker failed" };
      },
    });

    expect(result).toEqual({ started: 1, stoppedReason: "blocked" });
    expect(executions).toEqual([failed.runId]);
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: failed.runId } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      blockedReason: "Worker failed",
    });
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: later.runId } }),
    ).resolves.toMatchObject({ status: "QUEUED", queueSequence: 2 });
    await expect(
      prisma.projectQueueState.findUniqueOrThrow({
        where: { projectId: project.id },
      }),
    ).resolves.toMatchObject({
      state: "BLOCKED",
      activeRunId: null,
      blockedRunId: failed.runId,
    });
  });

  it("continues after skip clears the blocked queue", async () => {
    const { user, project, session } = await createFixture();
    const failed = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Fail",
      providerSessionId: "provider-1",
    });
    const later = await enqueueFixtureRun({
      projectId: project.id,
      sessionId: session.id,
      userId: user.id,
      prompt: "Later",
      providerSessionId: "provider-2",
    });
    await drainProjectQueue({
      projectId: project.id,
      execute: async () => ({ ok: false, message: "Worker failed" }),
    });

    await skipAgentRun({ projectId: project.id, runId: failed.runId });
    const executions: string[] = [];
    const result = await drainProjectQueue({
      projectId: project.id,
      execute: async ({ runId }) => {
        executions.push(runId);
        return { ok: true, agentMessage: "Recovered" };
      },
    });

    expect(result).toEqual({ started: 1, stoppedReason: "empty" });
    expect(executions).toEqual([later.runId]);
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: failed.runId } }),
    ).resolves.toMatchObject({ status: "FAILED" });
    await expect(
      prisma.agentRun.findUniqueOrThrow({ where: { id: later.runId } }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      prisma.agentRunEvent.findFirstOrThrow({
        where: { runId: failed.runId, type: "STATUS" },
        orderBy: { sequence: "desc" },
      }),
    ).resolves.toMatchObject({
      payload: { status: "SKIPPED" },
    });
  });
});
