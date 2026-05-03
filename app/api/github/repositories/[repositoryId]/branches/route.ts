import { NextResponse } from "next/server";

import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { listRepositoryBranches } from "@/lib/github/repositories";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { repositoryId } = await params;
  try {
    const branches = await listRepositoryBranches(currentUser.user.id, repositoryId);
    return NextResponse.json({ branches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
