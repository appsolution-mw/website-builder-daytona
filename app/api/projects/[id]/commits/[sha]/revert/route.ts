import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import {
  brokerRevertToCommit,
  type BrokerRpcProject,
} from "@/lib/runtime/broker-rpc";

const SHA_RE = /^[a-f0-9]{40}$/;
const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const;

type RouteContext = { params: Promise<{ id: string; sha: string }> };

export async function POST(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id: projectId, sha } = await params;
  if (!SHA_RE.test(sha)) {
    return NextResponse.json({ error: "invalid sha" }, { status: 400 });
  }

  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: currentUser.user.id },
    select: {
      id: true,
      brokerUrl: true,
      brokerPreviewToken: true,
    },
  });
  if (!project || !project.brokerUrl) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const targetCommit = await prisma.commit.findFirst({
    where: { projectId, sha },
    select: { id: true, sha: true },
  });
  if (!targetCommit) {
    return NextResponse.json({ reason: "unknown_sha" }, { status: 404 });
  }

  const headCommit = await prisma.commit.findFirst({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { sha: true },
  });
  if (headCommit?.sha === sha) {
    return NextResponse.json({ reason: "is_head" }, { status: 409 });
  }

  const activeRun = await prisma.agentRun.findFirst({
    where: { projectId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true, status: true },
  });
  if (activeRun) {
    return NextResponse.json(
      { reason: "not_idle", runStatus: activeRun.status },
      { status: 409 },
    );
  }

  const brokerProject: BrokerRpcProject = {
    brokerUrl: project.brokerUrl,
    brokerPreviewToken: project.brokerPreviewToken,
  };
  const triggeredBy = `user:${currentUser.user.id}`;

  const result = await brokerRevertToCommit(brokerProject, sha, triggeredBy);

  if (!result.ok) {
    switch (result.reason) {
      case "dirty_tree":
        return NextResponse.json({ reason: "dirty_tree" }, { status: 400 });
      case "unknown_sha":
        return NextResponse.json({ reason: "unknown_sha" }, { status: 404 });
      case "is_head":
        return NextResponse.json({ reason: "is_head" }, { status: 409 });
      case "commit_failed":
        return NextResponse.json(
          { reason: "commit_failed", detail: result.detail },
          { status: 500 },
        );
    }
  }

  await prisma.commit.create({
    data: {
      projectId,
      sessionId: null,
      agentRunId: null,
      sha: result.sha,
      shortSha: result.shortSha,
      authorKind: "ROLLBACK",
      runtime: null,
      modelId: null,
      title: result.title,
      bodyMessage: result.bodyMessage,
      filesChanged: result.filesChanged,
      insertions: result.insertions,
      deletions: result.deletions,
      revertedFromSha: result.revertedFromSha,
      createdAt: new Date(result.committedAt),
    },
  });

  return NextResponse.json(
    {
      newSha: result.sha,
      shortSha: result.shortSha,
      title: result.title,
      filesChanged: result.filesChanged,
      insertions: result.insertions,
      deletions: result.deletions,
      revertedFromSha: result.revertedFromSha,
      committedAt: result.committedAt,
    },
    { status: 201 },
  );
}
