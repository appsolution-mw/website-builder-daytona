import { NextResponse } from "next/server";
import { drainWorker } from "@/lib/admin/workers";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(_request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const result = await drainWorker(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
