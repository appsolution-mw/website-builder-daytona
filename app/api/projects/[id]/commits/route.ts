import { NextResponse } from "next/server";
import type { Commit } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsedLimit = parseInt(
    url.searchParams.get("limit") ?? String(DEFAULT_LIMIT),
    10,
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_LIMIT),
  );
  const cursorId = url.searchParams.get("cursor");

  const commits = await prisma.commit.findMany({
    where: { projectId: project.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  const hasMore = commits.length > limit;
  const slice = hasMore ? commits.slice(0, limit) : commits;
  return NextResponse.json({
    commits: slice.map(serializeCommit),
    nextCursor: hasMore ? slice.at(-1)!.id : null,
  });
}

function serializeCommit(commit: Commit): {
  id: string;
  sha: string;
  shortSha: string;
  title: string;
  bodyMessage: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  runtime: Commit["runtime"];
  modelId: string | null;
  authorKind: Commit["authorKind"];
  sessionId: string | null;
  agentRunId: string | null;
  createdAt: string;
} {
  return {
    id: commit.id,
    sha: commit.sha,
    shortSha: commit.shortSha,
    title: commit.title,
    bodyMessage: commit.bodyMessage,
    filesChanged: commit.filesChanged,
    insertions: commit.insertions,
    deletions: commit.deletions,
    runtime: commit.runtime,
    modelId: commit.modelId,
    authorKind: commit.authorKind,
    sessionId: commit.sessionId,
    agentRunId: commit.agentRunId,
    createdAt: commit.createdAt.toISOString(),
  };
}
