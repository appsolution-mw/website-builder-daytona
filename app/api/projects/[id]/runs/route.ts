import type {
  AgentRunStatus,
  AgentRuntime as PrismaAgentRuntime,
  ProjectQueueStatus,
} from "@prisma/client";
import type { AgentRuntime } from "@wbd/protocol";
import { NextResponse, type NextRequest } from "next/server";
import { dbRuntimeToProtocol, isAgentRuntime, protocolRuntimeToDb } from "@/lib/agents/runtime";
import {
  parseAttachmentsPayload,
  type ParsedAttachment,
} from "@/lib/agent-runs/attachments";
import { enqueueAgentRun } from "@/lib/agent-runs/queue";
import { requestProjectQueueDrain } from "@/lib/agent-runs/executor-client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/client";
import {
  createSessionLibrarySnapshot,
  resolveWorkflowPreset,
} from "@/lib/library/service";
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
  libraryPresetItemId?: string | null;
  libraryPresetRevisionId?: string | null;
  attachments: ParsedAttachment[];
};

const LIST_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const attachmentsResult = parseAttachmentsPayload(body.attachments);
  if (!attachmentsResult.ok) {
    return NextResponse.json(
      { error: attachmentsResult.error.message },
      { status: 400 },
    );
  }
  const payload = parseEnqueuePayload(body, attachmentsResult.attachments);
  if (!payload) {
    return NextResponse.json({ error: "invalid run payload" }, { status: 400 });
  }
  if (payload.runtime === "vercel-ai" && payload.attachments.length > 0) {
    return NextResponse.json(
      { error: "image attachments are not supported for the vercel-ai runtime" },
      { status: 400 },
    );
  }

  const session = await prisma.session.findFirst({
    where: { id: payload.sessionId, projectId: project.id },
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const runtime = protocolRuntimeToDb(payload.runtime);
  let librarySnapshotId: string | null = null;
  let effectiveModelId = payload.modelId;

  try {
    const runtimeState = await prisma.sessionRuntimeState.upsert({
      where: {
        sessionId_runtime: {
          sessionId: payload.sessionId,
          runtime,
        },
      },
      create: {
        projectId: project.id,
        sessionId: payload.sessionId,
        runtime,
        providerSessionId: payload.providerSessionId,
        modelId: payload.modelId,
      },
      update: {
        providerSessionId: payload.providerSessionId,
        modelId: payload.modelId,
        lastUsedAt: new Date(),
      },
    });

    if (payload.runtime === "openhands" && payload.libraryPresetItemId) {
      const snapshotPayload = await resolveWorkflowPreset({
        userId: currentUser.user.id,
        presetItemId: payload.libraryPresetItemId,
        presetRevisionId: payload.libraryPresetRevisionId ?? undefined,
      });
      effectiveModelId = effectiveModelId ?? snapshotPayload.modelId;
      const snapshot = await createSessionLibrarySnapshot({
        userId: currentUser.user.id,
        projectId: project.id,
        sessionId: payload.sessionId,
        sessionRuntimeStateId: runtimeState.id,
        presetItemId: payload.libraryPresetItemId,
        presetRevisionId: payload.libraryPresetRevisionId,
        payload: snapshotPayload,
      });
      librarySnapshotId = snapshot.id;
    }
  } catch (error) {
    if (isLibraryPresetError(error)) {
      return NextResponse.json({ error: "invalid library preset" }, { status: 400 });
    }
    throw error;
  }

  const result = await enqueueAgentRun({
    projectId: project.id,
    sessionId: payload.sessionId,
    userId: currentUser.user.id,
    prompt: payload.prompt,
    runtime: payload.runtime,
    providerSessionId: payload.providerSessionId,
    modelId: effectiveModelId,
    ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
    ...(librarySnapshotId ? { librarySnapshotId } : {}),
  });
  requestProjectQueueDrain(project.id).catch((error: unknown) => {
    console.error("project queue drain failed", error);
  });

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

function parseEnqueuePayload(
  body: Record<string, unknown>,
  attachments: ParsedAttachment[],
): EnqueuePayload | null {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const promptRaw = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? body.runtime
    : null;
  const providerSessionId = typeof body.providerSessionId === "string"
    ? body.providerSessionId.trim()
    : "";
  const prompt = promptRaw.length > 0
    ? promptRaw
    : attachments.length > 0
      ? "Use the attached image as context."
      : "";
  if (!sessionId || !prompt || !runtime || !UUID_RE.test(providerSessionId)) {
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
  const libraryPresetItemId = typeof body.libraryPresetItemId === "string" && body.libraryPresetItemId.trim()
    ? body.libraryPresetItemId.trim()
    : null;
  const libraryPresetRevisionId = typeof body.libraryPresetRevisionId === "string" && body.libraryPresetRevisionId.trim()
    ? body.libraryPresetRevisionId.trim()
    : null;

  return {
    sessionId,
    prompt,
    runtime,
    providerSessionId,
    modelId,
    libraryPresetItemId,
    libraryPresetRevisionId,
    attachments,
  };
}

function hasStringProperty(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function errorCode(error: unknown): string | null {
  if (!hasStringProperty(error, "code")) return null;
  return typeof error.code === "string" ? error.code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLibraryPresetError(error: unknown): boolean {
  if (errorCode(error) === "P2025") return true;
  const message = errorMessage(error);
  return [
    "missing skill revision",
    "missing agent revision",
    "does not belong to item",
    "project not found for user",
    "session not found for project",
    "session runtime state not found for project session",
  ].some((fragment) => message.includes(fragment));
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
