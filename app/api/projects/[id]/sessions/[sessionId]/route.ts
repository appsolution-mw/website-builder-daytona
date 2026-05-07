import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { dbRuntimeToProtocol, isAgentRuntime, protocolRuntimeToDb } from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";
import {
  createSessionLibrarySnapshot,
  resolveWorkflowPreset,
} from "@/lib/library/service";
import type { SessionLibrarySnapshotPayload } from "@/lib/library/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RuntimeStatePatch = {
  runtime?: unknown;
  providerSessionId?: unknown;
  modelId?: unknown;
  libraryPresetItemId?: unknown;
  libraryPresetRevisionId?: unknown;
};

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

function isRuntimeStateUniqueConflict(error: unknown): boolean {
  return errorCode(error) === "P2002";
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id, sessionId } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      project: { id, ownerId: currentUser.user.id },
    },
    select: {
      ...sessionSelect,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          turnId: true,
          agentId: true,
          runtime: true,
          provider: true,
          modelId: true,
          createdAt: true,
          attachments: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              mimeType: true,
              sizeBytes: true,
              dataBase64: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const serializedSession = serializeSession(session);
  return NextResponse.json({
    session: Object.assign({}, serializedSession, {
      messages: session.messages.map((message) => ({
        ...message,
        runtime: message.runtime ? dbRuntimeToProtocol(message.runtime) : null,
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          dataUrl: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
        })),
      })),
    }),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body = (await request.json().catch(() => ({}))) as {
    defaultRuntime?: unknown;
    runtimeState?: unknown;
  };
  const defaultRuntime = typeof body.defaultRuntime === "string" && isAgentRuntime(body.defaultRuntime)
    ? protocolRuntimeToDb(body.defaultRuntime)
    : null;
  const runtimeState =
    body.runtimeState && typeof body.runtimeState === "object"
      ? body.runtimeState as RuntimeStatePatch
      : null;
  const runtime =
    typeof runtimeState?.runtime === "string" && isAgentRuntime(runtimeState.runtime)
      ? protocolRuntimeToDb(runtimeState.runtime)
      : null;
  const providerSessionId =
    typeof runtimeState?.providerSessionId === "string" ? runtimeState.providerSessionId.trim() : "";

  if (!defaultRuntime && !runtimeState) {
    return NextResponse.json({ error: "no update payload provided" }, { status: 400 });
  }
  if (runtimeState && (!runtime || !UUID_RE.test(providerSessionId))) {
    return NextResponse.json({ error: "invalid runtimeState" }, { status: 400 });
  }

  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      project: { id, ownerId: currentUser.user.id },
    },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const libraryPresetItemId =
      runtime === "OPENHANDS" && typeof runtimeState?.libraryPresetItemId === "string"
        ? runtimeState.libraryPresetItemId
        : null;
    const libraryPresetRevisionId =
      typeof runtimeState?.libraryPresetRevisionId === "string"
        ? runtimeState.libraryPresetRevisionId
        : undefined;
    const librarySnapshotPayload: SessionLibrarySnapshotPayload | null = libraryPresetItemId
      ? await resolveWorkflowPreset({
          userId: currentUser.user.id,
          presetItemId: libraryPresetItemId,
          presetRevisionId: libraryPresetRevisionId,
        })
      : null;

    if (runtime && providerSessionId) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<void> => {
        const runtimeStateRow = await tx.sessionRuntimeState.upsert({
          where: {
            sessionId_runtime: {
              sessionId: existing.id,
              runtime,
            },
          },
          create: {
            projectId: id,
            sessionId: existing.id,
            runtime,
            providerSessionId,
            modelId: typeof runtimeState?.modelId === "string" ? runtimeState.modelId : null,
          },
          update: {
            providerSessionId,
            modelId: typeof runtimeState?.modelId === "string" ? runtimeState.modelId : null,
            lastUsedAt: new Date(),
          },
        });

        if (!librarySnapshotPayload) return;
        await createSessionLibrarySnapshot({
          userId: currentUser.user.id,
          projectId: id,
          sessionId: existing.id,
          sessionRuntimeStateId: runtimeStateRow.id,
          payload: librarySnapshotPayload,
          tx,
        });
      });
    }

    const session = await prisma.session.update({
      where: { id: existing.id },
      data: defaultRuntime ? { defaultRuntime } : {},
      select: sessionSelect,
    });
    return NextResponse.json({ session: serializeSession(session) });
  } catch (error) {
    if (isRuntimeStateUniqueConflict(error)) {
      return NextResponse.json({ error: "runtime state already exists" }, { status: 409 });
    }
    if (isLibraryPresetError(error)) {
      return NextResponse.json({ error: "invalid library preset" }, { status: 400 });
    }
    console.error("[api] session update failed", error);
    return NextResponse.json({ error: "session update failed" }, { status: 500 });
  }
}
