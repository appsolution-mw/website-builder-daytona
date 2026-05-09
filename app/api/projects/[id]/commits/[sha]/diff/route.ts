import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { brokerGetCommitDiff } from "@/lib/runtime/broker-rpc";

const SHA_RE = /^[a-f0-9]{40}$/;
const UNSAFE_PATH_RE = /(^\/)|\.\.|\0/;
const MAX_DIFF_BYTES = 256 * 1024;
const TRUNCATED_SUFFIX = "…[truncated]";

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

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path || UNSAFE_PATH_RE.test(path)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
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

  const result = await brokerGetCommitDiff(
    { brokerUrl: project.brokerUrl, brokerPreviewToken: project.brokerPreviewToken },
    sha,
    path,
  );

  return NextResponse.json({ diff: truncateDiff(result.diff) });
}

function truncateDiff(diff: string): string {
  const buf = Buffer.from(diff, "utf8");
  if (buf.byteLength <= MAX_DIFF_BYTES) return diff;
  return buf.subarray(0, MAX_DIFF_BYTES).toString("utf8") + TRUNCATED_SUFFIX;
}
