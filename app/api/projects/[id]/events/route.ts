import { NextResponse } from "next/server";
import { listProjectEvents } from "@/lib/agent-runs/events";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { requireAccessibleProject } from "@/lib/workspaces/access";

type RouteContext = { params: Promise<{ id: string }> };

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

  const after = parseAfterCursor(new URL(request.url).searchParams.get("after"));
  if (after === null) {
    return NextResponse.json({ error: "invalid after cursor" }, { status: 400 });
  }

  const events = await listProjectEvents({
    projectId: project.id,
    after,
  });

  return NextResponse.json({ events });
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

function parseAfterCursor(value: string | null): number | undefined | null {
  if (value === null || value === "") {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const after = Number(value);
  return Number.isSafeInteger(after) ? after : null;
}
