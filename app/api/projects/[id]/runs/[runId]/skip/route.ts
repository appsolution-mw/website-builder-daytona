import { NextResponse } from "next/server";
import { requestProjectQueueDrain } from "@/lib/agent-runs/executor-client";
import { skipAgentRun } from "@/lib/agent-runs/queue";
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

  try {
    await skipAgentRun({ projectId: project.id, runId });
  } catch (error) {
    if (error instanceof Error && error.message === "Project queue is not blocked by run") {
      return NextResponse.json({ error: "run is not blocking the project queue" }, { status: 400 });
    }
    throw error;
  }
  await requestProjectQueueDrain(project.id);

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
