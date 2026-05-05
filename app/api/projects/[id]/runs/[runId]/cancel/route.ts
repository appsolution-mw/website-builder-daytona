import { NextResponse } from "next/server";
import { requestProjectRunCancel } from "@/lib/agent-runs/executor-client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/client";
import { requireAccessibleProject } from "@/lib/workspaces/access";

type RouteContext = { params: Promise<{ id: string; runId: string }> };

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id, runId } = await params;
  const project = await requireProject(id, currentUser.user.id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const run = await prisma.agentRun.findFirst({
    where: { id: runId, projectId: project.id },
    select: { id: true },
  });
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  await requestProjectRunCancel(project.id, runId);

  return NextResponse.json({ ok: true });
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
