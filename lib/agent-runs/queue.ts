import { Prisma } from "@prisma/client";
import type { AgentRuntime } from "@wbd/protocol";
import { protocolRuntimeToDb } from "@/lib/agents/runtime";
import { prisma } from "@/lib/db/client";
import { appendRunEvent } from "./events";

const MAX_QUEUE_SEQUENCE_RETRIES = 5;
const QUEUE_SEQUENCE_TARGET = ["projectId", "queueSequence"] as const;
const QUEUE_SEQUENCE_CONSTRAINT = "AgentRun_projectId_queueSequence_key";

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
      await appendRunEvent({
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
        lastAttemptNumber: true,
      },
    });
    const now = new Date();
    const attemptNumber = run.lastAttemptNumber + 1;
    const attempt = await tx.agentRunAttempt.create({
      data: {
        runId: run.id,
        attemptNumber,
        status: "STARTING",
        startedAt: now,
      },
      select: { id: true },
    });

    await tx.agentRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        startedAt: now,
        lastAttemptNumber: attemptNumber,
      },
    });
    await tx.projectQueueState.upsert({
      where: { projectId: run.projectId },
      create: {
        projectId: run.projectId,
        state: "RUNNING",
        activeRunId: run.id,
      },
      update: {
        state: "RUNNING",
        activeRunId: run.id,
        blockedRunId: null,
        blockedAt: null,
      },
    });

    return {
      projectId: run.projectId,
      sessionId: run.sessionId,
      attemptId: attempt.id,
      attemptNumber,
    };
  });

  await appendRunEvent({
    projectId: result.projectId,
    sessionId: result.sessionId,
    runId,
    attemptId: result.attemptId,
    type: "STATUS",
    payload: { status: "RUNNING", attemptNumber: result.attemptNumber },
  });

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
      },
    });
    const now = new Date();

    await tx.agentRunAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: "SUCCEEDED",
        finishedAt: now,
        exitCode: 0,
      },
    });
    await tx.agentRun.update({
      where: { id: input.runId },
      data: {
        status: "SUCCEEDED",
        finishedAt: now,
      },
    });
    await tx.projectQueueState.update({
      where: { projectId: run.projectId },
      data: {
        state: "IDLE",
        activeRunId: null,
      },
    });
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
      },
    });
    const now = new Date();

    await tx.agentRunAttempt.update({
      where: { id: input.attemptId },
      data: {
        status,
        finishedAt: now,
        errorMessage: input.message,
        exitCode,
      },
    });
    await tx.agentRun.update({
      where: { id: input.runId },
      data: {
        status,
        finishedAt: now,
        blockedReason: input.message,
      },
    });
    await tx.projectQueueState.upsert({
      where: { projectId: run.projectId },
      create: {
        projectId: run.projectId,
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: input.runId,
        blockedAt: now,
      },
      update: {
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: input.runId,
        blockedAt: now,
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
    type: "ERROR",
    payload: {
      status,
      message: input.message,
    },
  });
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
