import { NextResponse } from "next/server";
import { decommissionEmptyWorker } from "@/lib/admin/workers";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createHetznerWorkerProvisionerFromEnv } from "@/lib/runtime/provisioner/hetzner";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(_request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const provisioner = createHetznerWorkerProvisionerFromEnv();
  const result = await decommissionEmptyWorker(id, provisioner);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(null, { status: 204 });
}
