import { NextResponse } from "next/server";

import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { listInstallationRepositories } from "@/lib/github/repositories";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ installationId: string }> },
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { installationId } = await params;
  try {
    const repositories = await listInstallationRepositories(currentUser.user.id, installationId);
    return NextResponse.json({ repositories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
