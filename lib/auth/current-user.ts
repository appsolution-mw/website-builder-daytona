import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export type CurrentUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export type CurrentUserResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse };

function devFallbackUser(): CurrentUser | null {
  const userId = process.env.DEV_USER_ID;
  if (!userId) return null;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_USER_FALLBACK !== "1") {
    return null;
  }
  return { id: userId };
}

async function sessionUser(requestHeaders: Headers): Promise<CurrentUser | null> {
  try {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    };
  } catch {
    return null;
  }
}

export async function currentUserFromHeaders(requestHeaders: Headers): Promise<CurrentUser | null> {
  return (await sessionUser(requestHeaders)) ?? devFallbackUser();
}

export async function currentUserFromRequest(request: Request): Promise<CurrentUser | null> {
  return currentUserFromHeaders(request.headers);
}

export async function currentUserFromServerHeaders(): Promise<CurrentUser | null> {
  return currentUserFromHeaders(await headers());
}

export async function requireCurrentUserFromRequest(request: Request): Promise<CurrentUserResult> {
  const user = await currentUserFromRequest(request);
  if (user) return { ok: true, user };
  return {
    ok: false,
    response: NextResponse.json({ error: "not signed in" }, { status: 401 }),
  };
}
