import { Prisma } from "@prisma/client";
import type { AgentRuntime } from "@wbd/protocol";
import { protocolRuntimeToDb } from "@/lib/agents/runtime";
import { prisma } from "@/lib/db/client";
import { appendRunEvent } from "./events";

const MAX_QUEUE_SEQUENCE_RETRIES = 5;
const QUEUE_SEQUENCE_TARGET = ["projectId", "queueSequence"] as const;
const QUEUE_SEQUENCE_CONSTRAINT = "AgentRun_projectId_queueSequence_key";
const IN_FLIGHT_ATTEMPT_STATUSES = ["STARTING", "RUNNING"] as const;

type QueuedRunResult = {
  runId: string;
  messageId: string;
  queueSequence: number;
};

type QueueTransaction = Prisma.TransactionClient;

export async function nextProjectQueueSequence(
  projectId: string,
): Promise<number> {
  return nextProjectQueueSequenceInTx(prisma, projectId);
}

export async function enqueueAgentRun(input: {
  projectId: string;
  sessionId: string;
  userId: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
}): Promise<QueuedRunResult> {
  for (let attempt = 1; attempt <= MAX_QUEUE_SEQUENCE_RETRIES; attempt += 1) {
    try {
      const result = await createQueuedRun(input);
      await appendRunEventBestEffort({
        projectId: input.projectId,
        sessionId: input.sessionId,
        runId: result.runId,
        type: "STATUS",
        payload: {
          status: "QUEUED",
          queueSequence: result.queueSequence,
        },
      });
      return result;
    } catch (error) {
      if (
        !isQueueSequenceConflict(error) ||
        attempt === MAX_QUEUE_SEQUENCE_RETRIES
      ) {
        throw error;
      }
    }
  }

  throw new Error("Unable to enqueue agent run");
}

export async function getNextQueuedRun(
  projectId: string,
): Promise<{ id: string } | null> {
  const queueState = await prisma.projectQueueState.findUnique({
    where: { projectId },
    select: { state: true },
  });
  if (queueState?.state === "BLOCKED" || queueState?.state === "RUNNING") {
    return null;
  }

  return prisma.agentRun.findFirst({
    where: { projectId, status: "QUEUED" },
    select: { id: true },
    orderBy: { queueSequence: "asc" },
  });
}

export async function markRunStarting(
  runId: string,
): Promise<{ runId: string; attemptId: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        id: true,
        projectId: true,
        sessionId: true,
        status: true,
        lastAttemptNumber: true,
      },
    });
    const queueState = await tx.projectQueueState.findUnique({
      where: { projectId: run.projectId },
      select: { state: true, activeRunId: true },
    });

    if (run.status === "RUNNING") {
      if (
        queueState?.state !== "RUNNING" ||
        queueState.activeRunId !== run.id
      ) {
        throw new Error("Run is not the active project run");
      }

      const existingAttempt = await tx.agentRunAttempt.findFirst({
        where: {
          runId: run.id,
          status: { in: [...IN_FLIGHT_ATTEMPT_STATUSES] },
        },
        select: { id: true, attemptNumber: true },
        orderBy: { attemptNumber: "desc" },
      });
      if (!existingAttempt) {
        throw new Error("Run is already running without an in-flight attempt");
      }

      return {
        projectId: run.projectId,
        sessionId: run.sessionId,
        attemptId: existingAttempt.id,
        attemptNumber: existingAttempt.attemptNumber,
        startedNow: false,
      };
    }

    if (run.status !== "QUEUED") {
      throw new Error(`Cannot start run with status ${run.status}`);
    }

    if (queueState?.state === "BLOCKED") {
      throw new Error("Project queue is blocked");
    }
    if (
      queueState?.state === "RUNNING" &&
      queueState.activeRunId !== run.id
    ) {
      throw new Error("Project already has an active run");
    }

    const now = new Date();
    const attemptNumber = run.lastAttemptNumber + 1;
    await reserveProjectQueueForRun(tx, {
      projectId: run.projectId,
      runId: run.id,
    });
    const updatedRun = await tx.agentRun.updateMany({
      where: { id: run.id, status: "QUEUED" },
      data: {
        status: "RUNNING",
        startedAt: now,
        lastAttemptNumber: attemptNumber,
      },
    });
    if (updatedRun.count !== 1) {
      throw new Error("Run is no longer queued");
    }

    const attempt = await tx.agentRunAttempt.create({
      data: {
        runId: run.id,
        attemptNumber,
        status: "STARTING",
        startedAt: now,
      },
      select: { id: true },
    });

    return {
      projectId: run.projectId,
      sessionId: run.sessionId,
      attemptId: attempt.id,
      attemptNumber,
      startedNow: true,
    };
  });

  if (result.startedNow) {
    await appendRunEvent({
      projectId: result.projectId,
      sessionId: result.sessionId,
      runId,
      attemptId: result.attemptId,
      type: "STATUS",
      payload: { status: "RUNNING", attemptNumber: result.attemptNumber },
    });
  }

  return { runId, attemptId: result.attemptId };
}

export async function markRunSucceeded(input: {
  runId: string;
  attemptId: string;
  agentMessage: string;
}): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({
      where: { id: input.runId },
      select: {
        projectId: true,
        sessionId: true,
        runtime: true,
        modelId: true,
        status: true,
        lastAttemptNumber: true,
      },
    });
    await assertRunCompletionIsCurrent(tx, {
      projectId: run.projectId,
      runId: input.runId,
      runStatus: run.status,
      lastAttemptNumber: run.lastAttemptNumber,
      attemptId: input.attemptId,
    });
    const now = new Date();

    const updatedAttempt = await tx.agentRunAttempt.updateMany({
      where: {
        id: input.attemptId,
        runId: input.runId,
        status: { in: [...IN_FLIGHT_ATTEMPT_STATUSES] },
      },
      data: {
        status: "SUCCEEDED",
        finishedAt: now,
        exitCode: 0,
      },
    });
    assertSingleUpdate(updatedAttempt.count, "Run attempt is not in flight");

    const updatedRun = await tx.agentRun.updateMany({
      where: { id: input.runId, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        finishedAt: now,
      },
    });
    assertSingleUpdate(updatedRun.count, "Cannot complete run with stale status");

    const updatedQueueState = await tx.projectQueueState.updateMany({
      where: {
        projectId: run.projectId,
        state: "RUNNING",
        activeRunId: input.runId,
      },
      data: {
        state: "IDLE",
        activeRunId: null,
      },
    });
    assertSingleUpdate(
      updatedQueueState.count,
      "Run is not the active project run",
    );

    await tx.message.create({
      data: {
        projectId: run.projectId,
        sessionId: run.sessionId,
        role: "AGENT",
        content: input.agentMessage,
        runtime: run.runtime,
        modelId: run.modelId,
      },
    });

    return {
      projectId: run.projectId,
      sessionId: run.sessionId,
    };
  });

  await appendRunEvent({
    projectId: result.projectId,
    sessionId: result.sessionId,
    runId: input.runId,
    attemptId: input.attemptId,
    type: "DONE",
    payload: { status: "SUCCEEDED" },
  });
}

export async function markRunFailed(input: {
  runId: string;
  attemptId: string;
  message: string;
  cancelled?: boolean;
}): Promise<void> {
  const status = input.cancelled ? "CANCELLED" : "FAILED";
  const exitCode = input.cancelled ? -1 : 1;
  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findUniqueOrThrow({
      where: { id: input.runId },
      select: {
        projectId: true,
        sessionId: true,
        status: true,
        lastAttemptNumber: true,
      },
    });
    await assertRunCompletionIsCurrent(tx, {
      projectId: run.projectId,
      runId: input.runId,
      runStatus: run.status,
      lastAttemptNumber: run.lastAttemptNumber,
      attemptId: input.attemptId,
    });
    const now = new Date();

    const updatedAttempt = await tx.agentRunAttempt.updateMany({
      where: {
        id: input.attemptId,
        runId: input.runId,
        status: { in: [...IN_FLIGHT_ATTEMPT_STATUSES] },
      },
      data: {
        status,
        finishedAt: now,
        errorMessage: input.message,
        exitCode,
      },
    });
    assertSingleUpdate(updatedAttempt.count, "Run attempt is not in flight");

    const updatedRun = await tx.agentRun.updateMany({
      where: { id: input.runId, status: "RUNNING" },
      data: {
        status,
        finishedAt: now,
        blockedReason: input.message,
      },
    });
    assertSingleUpdate(updatedRun.count, "Cannot complete run with stale status");

    const updatedQueueState = await tx.projectQueueState.updateMany({
      where: {
        projectId: run.projectId,
        state: "RUNNING",
        activeRunId: input.runId,
      },
      data: {
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: input.runId,
        blockedAt: now,
      },
    });
    assertSingleUpdate(
      updatedQueueState.count,
      "Run is not the active project run",
    );

    return {
      projectId: run.projectId,
      sessionId: run.sessionId,
    };
  });

  await appendRunEvent({
    projectId: result.projectId,
    sessionId: result.sessionId,
    runId: input.runId,
    attemptId: input.attemptId,
    type: "ERROR",
    payload: {
      status,
      message: input.message,
    },
  });
}

async function reserveProjectQueueForRun(
  tx: QueueTransaction,
  input: { projectId: string; runId: string },
): Promise<void> {
  const queueState = await tx.projectQueueState.findUnique({
    where: { projectId: input.projectId },
    select: { state: true, activeRunId: true },
  });

  if (!queueState) {
    await tx.projectQueueState.create({
      data: {
        projectId: input.projectId,
        state: "RUNNING",
        activeRunId: input.runId,
      },
    });
    return;
  }

  if (queueState.state === "BLOCKED") {
    throw new Error("Project queue is blocked");
  }

  const reserved = await tx.projectQueueState.updateMany({
    where: {
      projectId: input.projectId,
      state: "IDLE",
      activeRunId: null,
    },
    data: {
      state: "RUNNING",
      activeRunId: input.runId,
      blockedRunId: null,
      blockedAt: null,
    },
  });
  if (reserved.count !== 1) {
    throw new Error("Project already has an active run");
  }
}

async function appendRunEventBestEffort(input: {
  runId: string;
  attemptId?: string | null;
  projectId: string;
  sessionId: string;
  type: Parameters<typeof appendRunEvent>[0]["type"];
  agentId?: string | null;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await appendRunEvent(input);
  } catch {
    // The durable queued run is the source of truth; queue recovery must not
    // rely on the advisory status event being present.
  }
}

async function assertRunCompletionIsCurrent(
  tx: QueueTransaction,
  input: {
    projectId: string;
    runId: string;
    runStatus: string;
    lastAttemptNumber: number;
    attemptId: string;
  },
): Promise<void> {
  if (input.runStatus !== "RUNNING") {
    throw new Error(`Cannot complete run with status ${input.runStatus}`);
  }

  const queueState = await tx.projectQueueState.findUnique({
    where: { projectId: input.projectId },
    select: { state: true, activeRunId: true },
  });
  if (
    queueState?.state !== "RUNNING" ||
    queueState.activeRunId !== input.runId
  ) {
    throw new Error("Run is not the active project run");
  }

  const attempt = await tx.agentRunAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    select: { attemptNumber: true, runId: true, status: true },
  });
  if (attempt.runId !== input.runId) {
    throw new Error("Run attempt does not belong to run");
  }
  if (attempt.attemptNumber !== input.lastAttemptNumber) {
    throw new Error("Run attempt is not current");
  }
  if (!isInFlightAttemptStatus(attempt.status)) {
    throw new Error("Run attempt is not in flight");
  }
}

function isInFlightAttemptStatus(status: string): boolean {
  return status === "STARTING" || status === "RUNNING";
}

function assertSingleUpdate(count: number, message: string): void {
  if (count !== 1) {
    throw new Error(message);
  }
}

async function createQueuedRun(input: {
  projectId: string;
  sessionId: string;
  userId: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
}): Promise<QueuedRunResult> {
  const runtime = protocolRuntimeToDb(input.runtime);
  return prisma.$transaction(async (tx) => {
    const queueSequence = await nextProjectQueueSequenceInTx(
      tx,
      input.projectId,
    );
    const message = await tx.message.create({
      data: {
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "USER",
        content: input.prompt,
        runtime,
        modelId: input.modelId ?? null,
      },
      select: { id: true },
    });
    const run = await tx.agentRun.create({
      data: {
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessageId: message.id,
        createdById: input.userId,
        runtime,
        providerSessionId: input.providerSessionId,
        modelId: input.modelId ?? null,
        queueSequence,
      },
      select: { id: true },
    });

    await tx.projectQueueState.upsert({
      where: { projectId: input.projectId },
      create: {
        projectId: input.projectId,
        state: "IDLE",
      },
      update: {},
    });
    await tx.session.update({
      where: { id: input.sessionId },
      data: { lastMessageAt: new Date() },
    });

    return {
      runId: run.id,
      messageId: message.id,
      queueSequence,
    };
  });
}

async function nextProjectQueueSequenceInTx(
  tx: Pick<QueueTransaction, "agentRun">,
  projectId: string,
): Promise<number> {
  const latest = await tx.agentRun.findFirst({
    where: { projectId },
    select: { queueSequence: true },
    orderBy: { queueSequence: "desc" },
  });
  return (latest?.queueSequence ?? 0) + 1;
}

function isQueueSequenceConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = error.meta;
  if (meta?.modelName !== undefined && meta.modelName !== "AgentRun") {
    return false;
  }

  return (
    isQueueSequenceTarget(meta?.target) ||
    meta?.constraint === QUEUE_SEQUENCE_CONSTRAINT ||
    isQueueSequenceTarget(readDriverAdapterConstraintFields(meta))
  );
}

function isQueueSequenceTarget(target: unknown): boolean {
  return (
    Array.isArray(target) &&
    target.length === QUEUE_SEQUENCE_TARGET.length &&
    target.every(
      (field, index) =>
        typeof field === "string" &&
        normalizeConstraintField(field) === QUEUE_SEQUENCE_TARGET[index],
    )
  );
}

function normalizeConstraintField(field: string): string {
  return field.replace(/^"+|"+$/g, "");
}

function readDriverAdapterConstraintFields(
  meta: Record<string, unknown> | undefined,
): unknown {
  const driverAdapterError = toRecord(meta?.driverAdapterError);
  const cause = toRecord(driverAdapterError?.cause);
  const constraint = toRecord(cause?.constraint);
  return constraint?.fields;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}
