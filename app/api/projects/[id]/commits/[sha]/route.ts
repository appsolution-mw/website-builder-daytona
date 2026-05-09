import { NextResponse } from "next/server";
import type { Commit } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

const SHA_RE = /^[a-f0-9]{40}$/;

type RouteContext = { params: Promise<{ id: string; sha: string }> };

export async function GET(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id, sha } = await params;
  if (!SHA_RE.test(sha)) {
    return NextResponse.json({ error: "invalid sha" }, { status: 400 });
  }

  const commit = await prisma.commit.findFirst({
    where: { sha, project: { id, ownerId: currentUser.user.id } },
  });
  if (!commit) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ commit: serializeCommit(commit) });
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
