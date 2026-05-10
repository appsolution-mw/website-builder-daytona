import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createRuntime } from "@/lib/runtime";
import { AGENT_RUNTIME_OPTIONS, dbRuntimeToProtocol } from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";
import { serializeCommit } from "@/lib/workspace/commit-serializer";

const DEFAULT_SESSION_TITLE = "Main chat";

async function ensureProjectSession(projectId: string) {
  const existing = await prisma.session.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: sessionSelect,
  });
  if (existing) return existing;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { agentRuntime: true },
  });
  const session = await prisma.session.create({
    data: {
      projectId,
      title: DEFAULT_SESSION_TITLE,
      defaultRuntime: project?.agentRuntime ?? "CLAUDE_CODE",
    },
    select: sessionSelect,
  });
  await prisma.sessionRuntimeState.create({
    data: {
      projectId,
      sessionId: session.id,
      runtime: project?.agentRuntime ?? "CLAUDE_CODE",
      providerSessionId: randomUUID(),
    },
  });
  return prisma.session.findUniqueOrThrow({
    where: { id: session.id },
    select: sessionSelect,
  });
}

async function listProjectSessions(projectId: string) {
  return prisma.session.findMany({
    where: { projectId },
    orderBy: { lastMessageAt: "desc" },
    select: sessionSelect,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const chatSession = await ensureProjectSession(project.id);
  const chatSessions = await listProjectSessions(project.id);
  const recentCommits = await prisma.commit.findMany({
    where: { projectId: project.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });

  return NextResponse.json({
    project: {
      ...project,
      agentRuntime: dbRuntimeToProtocol(project.agentRuntime),
      desiredRuntime: dbRuntimeToProtocol(project.desiredRuntime),
      availableRuntimes: AGENT_RUNTIME_OPTIONS,
      chatSession: serializeSession(chatSession),
      chatSessions: chatSessions.map(serializeSession),
      commits: recentCommits.map(serializeCommit),
    },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (project.sandboxId) {
    try {
      const runtime = createRuntime();
      await runtime.destroyProjectSandbox(project.sandboxId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[api] destroy sandbox ${project.sandboxId} failed: ${message}`);
      // Continue — fall through to marking the project DESTROYED
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { status: "DESTROYED", brokerUrl: null, brokerPreviewToken: null, previewUrl: null },
  });

  return new NextResponse(null, { status: 204 });
}
