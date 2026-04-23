import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { createDaytonaClient } from "@/lib/daytona";
import { createFakeClient } from "@/lib/daytona/fake";
import { AGENT_RUNTIME_OPTIONS, dbRuntimeToProtocol } from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const FAKE_PREVIEW_HEALTH_TIMEOUT_MS = 500;
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

async function isFakePreviewReachable(previewUrl: string | null): Promise<boolean> {
  if (!previewUrl) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAKE_PREVIEW_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(previewUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (
    project.status === "RUNNING" &&
    project.daytonaSandboxId?.startsWith("fake-") &&
    !(await isFakePreviewReachable(project.previewUrl))
  ) {
    const daytona = createFakeClient();
    const info = await daytona.spawnProjectSandbox({
      projectId: project.id,
      cloneToken: "",
      repoOwner: "",
      repoName: "",
    });
    project = await prisma.project.update({
      where: { id: project.id },
      data: {
        daytonaSandboxId: info.sandboxId,
        brokerUrl: info.brokerUrl,
        brokerPreviewToken: info.brokerPreviewToken,
        previewUrl: info.previewUrl,
      },
    });
  }

  const chatSession = await ensureProjectSession(project.id);
  const chatSessions = await listProjectSessions(project.id);

  return NextResponse.json({
    project: {
      ...project,
      agentRuntime: dbRuntimeToProtocol(project.agentRuntime),
      desiredRuntime: dbRuntimeToProtocol(project.desiredRuntime),
      availableRuntimes: AGENT_RUNTIME_OPTIONS,
      chatSession: serializeSession(chatSession),
      chatSessions: chatSessions.map(serializeSession),
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (project.daytonaSandboxId) {
    const daytona = project.daytonaSandboxId.startsWith("fake-")
      ? createFakeClient()
      : createDaytonaClient();
    try {
      await daytona.destroyProjectSandbox(project.daytonaSandboxId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[api] destroy sandbox ${project.daytonaSandboxId} failed: ${message}`);
      // Continue — fall through to marking the project DESTROYED
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { status: "DESTROYED", brokerUrl: null, brokerPreviewToken: null, previewUrl: null },
  });

  return new NextResponse(null, { status: 204 });
}
