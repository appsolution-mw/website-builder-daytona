import { prisma } from "@/lib/db/client";
import {
  getNextQueuedRun,
  markRunFailed,
  markRunStarting,
  markRunSucceeded,
} from "./queue";

const DEFAULT_MAX_DRAIN_RUNS = 10;

export type RunExecutionAdapter = (input: {
  runId: string;
  attemptId: string;
}) => Promise<
  | { ok: true; agentMessage: string }
  | { ok: false; message: string; cancelled?: boolean }
>;

export type QueueDrainStoppedReason =
  | "empty"
  | "blocked"
  | "active"
  | "limit";

export async function drainProjectQueue(input: {
  projectId: string;
  execute: RunExecutionAdapter;
  maxRuns?: number;
}): Promise<{ started: number; stoppedReason: QueueDrainStoppedReason }> {
  let started = 0;
  const maxRuns = input.maxRuns ?? DEFAULT_MAX_DRAIN_RUNS;

  while (started < maxRuns) {
    const state = await prisma.projectQueueState.findUnique({
      where: { projectId: input.projectId },
      select: { state: true, activeRunId: true },
    });
    if (state?.state === "BLOCKED") {
      return { started, stoppedReason: "blocked" };
    }
    if (state?.state === "RUNNING" || state?.activeRunId) {
      return { started, stoppedReason: "active" };
    }

    const next = await getNextQueuedRun(input.projectId);
    if (!next) {
      return { started, stoppedReason: "empty" };
    }

    const { runId, attemptId, startedNow } = await markRunStarting(next.id);
    if (!startedNow) {
      return { started, stoppedReason: "active" };
    }

    started += 1;
    const result = await executeRun(input.execute, { runId, attemptId });
    if (result.ok) {
      await markRunSucceeded({
        runId,
        attemptId,
        agentMessage: result.agentMessage,
      });
      continue;
    }

    await markRunFailed({
      runId,
      attemptId,
      message: result.message,
      cancelled: result.cancelled,
    });
    return { started, stoppedReason: "blocked" };
  }

  return { started, stoppedReason: "limit" };
}

async function executeRun(
  execute: RunExecutionAdapter,
  input: { runId: string; attemptId: string },
): ReturnType<RunExecutionAdapter> {
  try {
    return await execute(input);
  } catch (error) {
    return {
      ok: false,
      message: errorToMessage(error),
    };
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Run execution failed";
}
