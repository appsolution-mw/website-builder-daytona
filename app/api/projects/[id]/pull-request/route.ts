import { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/client";
import {
  createProjectPullRequest,
  ProjectPullRequestError,
} from "@/lib/github/pull-requests";
import { getProjectGitStatus } from "@/lib/projects/broker-git";
import { requireAccessibleProject } from "@/lib/workspaces/access";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const access = await requireProject(id, currentUser.user.id);
  if (!access.ok) return access.response;

  const [status, project] = await Promise.all([
    getProjectGitStatus(id),
    prisma.project.findUnique({
      where: { id },
      select: {
        githubPullRequestUrl: true,
        githubWorkingBranch: true,
      },
    }),
  ]);

  return NextResponse.json({
    status,
    pullRequestUrl: project?.githubPullRequestUrl ?? null,
    branch: project?.githubWorkingBranch ?? null,
  });
}

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim()
    : undefined;

  try {
    const result = await createProjectPullRequest({
      userId: currentUser.user.id,
      projectId: id,
      title,
    });
    return NextResponse.json({ pullRequest: result }, { status: 201 });
  } catch (error) {
    if (error instanceof ProjectPullRequestError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: statusForPullRequestError(error.code) },
      );
    }
    throw error;
  }
}

async function requireProject(
  projectId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  try {
    await requireAccessibleProject({ projectId, userId });
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "project_not_found") {
      return {
        ok: false,
        response: NextResponse.json({ error: "not found" }, { status: 404 }),
      };
    }
    throw error;
  }
}

function statusForPullRequestError(code: ProjectPullRequestError["code"]): number {
  switch (code) {
    case "project_not_found":
      return 404;
    case "github_source_incomplete":
    case "project_busy":
    case "no_changes":
      return 409;
    case "github_api_failed":
    case "sandbox_push_failed":
      return 502;
  }
}
