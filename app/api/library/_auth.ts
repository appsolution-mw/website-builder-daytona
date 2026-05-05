import type { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

export type LibraryUserResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function requireLibraryUser(request: Request): Promise<LibraryUserResult> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser;
  return { ok: true, userId: currentUser.user.id };
}
