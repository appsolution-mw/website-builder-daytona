import { NextResponse, type NextRequest } from "next/server";

import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { upsertUserInstallation } from "@/lib/github/installations";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", "/");
    return NextResponse.redirect(signInUrl);
  }

  const installationId = request.nextUrl.searchParams.get("installation_id");
  if (!installationId) {
    return NextResponse.json({ error: "missing installation_id" }, { status: 400 });
  }

  await upsertUserInstallation(currentUser.user.id, installationId);

  const dashboardUrl = new URL("/", request.url);
  dashboardUrl.searchParams.set("github", "connected");
  return NextResponse.redirect(dashboardUrl);
}
