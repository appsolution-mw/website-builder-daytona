import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { brokerGetCommitFiles } from "@/lib/runtime/broker-rpc";

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

  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
    select: { brokerReady: true, brokerUrl: true, brokerPreviewToken: true },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!project.brokerReady || !project.brokerUrl) {
    return NextResponse.json({ error: "broker not ready" }, { status: 503 });
  }

  const result = await brokerGetCommitFiles(
    { brokerUrl: project.brokerUrl, brokerPreviewToken: project.brokerPreviewToken },
    sha,
  );
  return NextResponse.json(result);
}
