import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { SerializableRunEvent } from "./types";

const DEFAULT_EVENT_REPLAY_LIMIT = 200;
const MAX_EVENT_REPLAY_LIMIT = 500;
const MAX_APPEND_RETRIES = 5;

type RunEventRecord = {
  id: string;
  runId: string;
  attemptId: string | null;
  projectId: string;
  sessionId: string;
  sequence: number;
  type: SerializableRunEvent["type"];
  agentId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

export function serializeRunEvent(event: RunEventRecord): SerializableRunEvent {
  return {
    id: event.id,
    runId: event.runId,
    attemptId: event.attemptId,
    projectId: event.projectId,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type,
    agentId: event.agentId,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function nextProjectEventSequence(
  projectId: string,
): Promise<number> {
  const latest = await prisma.agentRunEvent.findFirst({
    where: { projectId },
    select: { sequence: true },
    orderBy: { sequence: "desc" },
  });
  return (latest?.sequence ?? 0) + 1;
}

export async function appendRunEvent(input: {
  runId: string;
  attemptId?: string | null;
  projectId: string;
  sessionId: string;
  type: SerializableRunEvent["type"];
  agentId?: string | null;
  payload: Prisma.InputJsonValue;
}): Promise<SerializableRunEvent> {
  for (let attempt = 1; attempt <= MAX_APPEND_RETRIES; attempt += 1) {
    try {
      const event = await createRunEvent(input);
      return serializeRunEvent(event);
    } catch (error) {
      if (!isEventSequenceConflict(error) || attempt === MAX_APPEND_RETRIES) {
        throw error;
      }
    }
  }

  throw new Error("Unable to append agent run event");
}

export async function listProjectEvents(input: {
  projectId: string;
  after?: number;
  limit?: number;
}): Promise<SerializableRunEvent[]> {
  const events = await prisma.agentRunEvent.findMany({
    where: {
      projectId: input.projectId,
      ...(input.after === undefined
        ? {}
        : { sequence: { gt: input.after } }),
    },
    orderBy: { sequence: "asc" },
    take: clampReplayLimit(input.limit),
  });
  return events.map(serializeRunEvent);
}

async function createRunEvent(input: {
  runId: string;
  attemptId?: string | null;
  projectId: string;
  sessionId: string;
  type: SerializableRunEvent["type"];
  agentId?: string | null;
  payload: Prisma.InputJsonValue;
}): Promise<RunEventRecord> {
  const sequence = await nextProjectEventSequence(input.projectId);
  return prisma.agentRunEvent.create({
    data: {
      runId: input.runId,
      attemptId: input.attemptId ?? null,
      projectId: input.projectId,
      sessionId: input.sessionId,
      sequence,
      type: input.type,
      agentId: input.agentId ?? null,
      payload: input.payload,
    },
  });
}

function clampReplayLimit(limit: number | undefined): number {
  return Math.min(
    Math.max(limit ?? DEFAULT_EVENT_REPLAY_LIMIT, 1),
    MAX_EVENT_REPLAY_LIMIT,
  );
}

function isEventSequenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
