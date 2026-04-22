import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { createDaytonaClient } from "@/lib/daytona";
import { createFakeClient } from "@/lib/daytona/fake";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const FAKE_PREVIEW_HEALTH_TIMEOUT_MS = 500;
const DEFAULT_SESSION_TITLE = "Main chat";

async function ensureProjectSession(projectId: string) {
  const existing = await prisma.session.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      claudeSessionId: true,
      createdAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });
  if (existing) return existing;

  return prisma.session.create({
    data: {
      projectId,
      title: DEFAULT_SESSION_TITLE,
      claudeSessionId: randomUUID(),
    },
    select: {
      id: true,
      title: true,
      claudeSessionId: true,
      createdAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
  });
}

async function listProjectSessions(projectId: string) {
  return prisma.session.findMany({
    where: { projectId },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      title: true,
      claudeSessionId: true,
      createdAt: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
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

  return NextResponse.json({ project: { ...project, chatSession, chatSessions } });
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
