import { NextResponse } from "next/server";

import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { githubAppInstallUrl } from "@/lib/github/app";
import { listUserInstallations } from "@/lib/github/installations";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const installations = await listUserInstallations(currentUser.user.id);
  return NextResponse.json({
    installUrl: githubAppInstallUrl(),
    installations,
  });
}
