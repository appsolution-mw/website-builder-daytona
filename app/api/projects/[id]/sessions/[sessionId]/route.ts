import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { dbRuntimeToProtocol, isAgentRuntime, protocolRuntimeToDb } from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      ? body.runtimeState as {
          runtime?: unknown;
          providerSessionId?: unknown;
          modelId?: unknown;
        }
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
    if (runtime && providerSessionId) {
      await prisma.sessionRuntimeState.upsert({
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
    }

    const session = await prisma.session.update({
      where: { id: existing.id },
      data: defaultRuntime ? { defaultRuntime } : {},
      select: sessionSelect,
    });
    return NextResponse.json({ session: serializeSession(session) });
  } catch {
    return NextResponse.json({ error: "runtime state already exists" }, { status: 409 });
  }
}
