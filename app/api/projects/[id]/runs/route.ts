import type {
  AgentRunStatus,
  AgentRuntime as PrismaAgentRuntime,
  ProjectQueueStatus,
} from "@prisma/client";
import type { AgentRuntime } from "@wbd/protocol";
import { NextResponse, type NextRequest } from "next/server";
import { dbRuntimeToProtocol, isAgentRuntime } from "@/lib/agents/runtime";
import { enqueueAgentRun } from "@/lib/agent-runs/queue";
import { requestProjectQueueDrain } from "@/lib/agent-runs/executor-client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/client";
import { requireAccessibleProject } from "@/lib/workspaces/access";

type RouteContext = { params: Promise<{ id: string }> };

type RunRecord = {
  id: string;
  status: AgentRunStatus;
  queueSequence: number;
  sessionId: string;
  userMessageId: string | null;
  createdById: string;
  runtime: PrismaAgentRuntime;
  modelId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  blockedReason: string | null;
};

type QueueStateRecord = {
  state: ProjectQueueStatus;
  activeRunId: string | null;
  blockedRunId: string | null;
  blockedAt: Date | null;
  updatedAt: Date;
};

type EnqueuePayload = {
  sessionId: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
};

const LIST_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await requireProject(id, currentUser.user.id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const queueState = await prisma.projectQueueState.findUnique({
    where: { projectId: project.id },
    select: {
      state: true,
      activeRunId: true,
      blockedRunId: true,
      blockedAt: true,
      updatedAt: true,
    },
  });
  const pinnedRunIds = [
    queueState?.activeRunId ?? null,
    queueState?.blockedRunId ?? null,
  ].filter((runId): runId is string => Boolean(runId));
  const runs = await prisma.agentRun.findMany({
    where: {
      projectId: project.id,
      OR: [
        { status: { in: [...LIST_RUN_STATUSES] } },
        ...(pinnedRunIds.length > 0 ? [{ id: { in: pinnedRunIds } }] : []),
      ],
    },
    select: {
      id: true,
      status: true,
      queueSequence: true,
      sessionId: true,
      userMessageId: true,
      createdById: true,
      runtime: true,
      modelId: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      blockedReason: true,
    },
    orderBy: { queueSequence: "asc" },
  });

  return NextResponse.json({
    runs: runs.map(serializeRun),
    queueState: serializeQueueState(queueState),
  });
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await requireProject(id, currentUser.user.id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payload = parseEnqueuePayload(body);
  if (!payload) {
    return NextResponse.json({ error: "invalid run payload" }, { status: 400 });
  }

  const session = await prisma.session.findFirst({
    where: { id: payload.sessionId, projectId: project.id },
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const result = await enqueueAgentRun({
    projectId: project.id,
    sessionId: payload.sessionId,
    userId: currentUser.user.id,
    prompt: payload.prompt,
    runtime: payload.runtime,
    providerSessionId: payload.providerSessionId,
    modelId: payload.modelId,
  });
  await requestProjectQueueDrain(project.id);

  return NextResponse.json(result, { status: 201 });
}

async function requireProject(
  projectId: string,
  userId: string,
): Promise<{ id: string } | null> {
  try {
    return await requireAccessibleProject({ projectId, userId });
  } catch (error) {
    if (error instanceof Error && error.message === "project_not_found") {
      return null;
    }
    throw error;
  }
}

function parseEnqueuePayload(body: Record<string, unknown>): EnqueuePayload | null {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? body.runtime
    : null;
  const providerSessionId = typeof body.providerSessionId === "string"
    ? body.providerSessionId.trim()
    : "";
  if (!sessionId || !prompt || !runtime || !providerSessionId) {
    return null;
  }

  if (
    body.modelId !== undefined &&
    body.modelId !== null &&
    typeof body.modelId !== "string"
  ) {
    return null;
  }
  const modelId = typeof body.modelId === "string" && body.modelId.trim()
    ? body.modelId.trim()
    : null;

  return { sessionId, prompt, runtime, providerSessionId, modelId };
}

function serializeRun(run: RunRecord): {
  id: string;
  status: AgentRunStatus;
  queueSequence: number;
  sessionId: string;
  userMessageId: string | null;
  createdById: string;
  runtime: AgentRuntime;
  modelId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  blockedReason: string | null;
} {
  return {
    id: run.id,
    status: run.status,
    queueSequence: run.queueSequence,
    sessionId: run.sessionId,
    userMessageId: run.userMessageId,
    createdById: run.createdById,
    runtime: dbRuntimeToProtocol(run.runtime),
    modelId: run.modelId,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    blockedReason: run.blockedReason,
  };
}

function serializeQueueState(queueState: QueueStateRecord | null): {
  state: ProjectQueueStatus;
  activeRunId: string | null;
  blockedRunId: string | null;
  blockedAt: string | null;
  updatedAt: string | null;
} {
  return {
    state: queueState?.state ?? "IDLE",
    activeRunId: queueState?.activeRunId ?? null,
    blockedRunId: queueState?.blockedRunId ?? null,
    blockedAt: queueState?.blockedAt?.toISOString() ?? null,
    updatedAt: queueState?.updatedAt.toISOString() ?? null,
  };
}
