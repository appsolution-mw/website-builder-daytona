import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { serializeCommit } from "@/lib/workspace/commit-serializer";

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

