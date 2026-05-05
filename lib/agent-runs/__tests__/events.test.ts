import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  appendRunEvent,
  isEventSequenceConflict,
  listProjectEvents,
} from "../events";

const TEST_PREFIX = "agent-events-";

afterEach(async (): Promise<void> => {
  await prisma.agentRunEvent.deleteMany({
    where: { project: { name: { startsWith: TEST_PREFIX } } },
  });
  await prisma.agentRunAttempt.deleteMany({
    where: { run: { project: { name: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.agentRun.deleteMany({
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
});

async function createFixture(): Promise<{
  project: { id: string };
  session: { id: string };
  run: { id: string };
}> {
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      id: `${TEST_PREFIX}user-${suffix}`,
      email: `${TEST_PREFIX}${suffix}@test.local`,
    },
  });
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: `${TEST_PREFIX}project-${suffix}` },
    select: { id: true },
  });
  const session = await prisma.session.create({
    data: { projectId: project.id, title: "Events" },
    select: { id: true },
  });
  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      sessionId: session.id,
      role: "USER",
      content: "Build it",
    },
    select: { id: true },
  });
  const run = await prisma.agentRun.create({
    data: {
      projectId: project.id,
      sessionId: session.id,
      userMessageId: message.id,
      createdById: user.id,
      runtime: "OPENHANDS",
      providerSessionId: "provider-1",
      queueSequence: 1,
    },
    select: { id: true },
  });
  return { project, session, run };
}

describe("agent run events", () => {
  it("assigns monotone project sequences and replays after a cursor", async () => {
    const { project, session, run } = await createFixture();

    const first = await appendRunEvent({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      type: "STATUS",
      payload: { phase: "queued" },
    });
    const second = await appendRunEvent({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      type: "CHUNK",
      payload: { delta: "Hello" },
    });

    expect(first).toMatchObject({
      projectId: project.id,
      runId: run.id,
      sessionId: session.id,
      attemptId: null,
      sequence: 1,
      type: "STATUS",
      agentId: null,
      payload: { phase: "queued" },
    });
    expect(first.createdAt).toEqual(expect.any(String));
    expect(second.sequence).toBe(2);

    await expect(
      listProjectEvents({ projectId: project.id, after: 1 }),
    ).resolves.toMatchObject([{ sequence: 2, type: "CHUNK" }]);
  });

  it("keeps project event sequences unique under concurrent appends", async () => {
    const { project, session, run } = await createFixture();

    const events = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        appendRunEvent({
          projectId: project.id,
          sessionId: session.id,
          runId: run.id,
          type: "CHUNK",
          payload: { index },
        }),
      ),
    );

    expect(events.map((event) => event.sequence).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    await expect(listProjectEvents({ projectId: project.id })).resolves.toHaveLength(
      5,
    );
  });

  it("does not classify unrelated unique conflicts as retryable sequence conflicts", () => {
    const unrelatedConflict = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      {
        clientVersion: "test",
        code: "P2002",
        meta: { target: ["email"] },
      },
    );

    expect(isEventSequenceConflict(unrelatedConflict)).toBe(false);
  });
});
