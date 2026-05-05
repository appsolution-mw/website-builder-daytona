import { NextResponse } from "next/server";
import { listWorkers, parseCreateWorkerInput } from "@/lib/admin/workers";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createHetznerWorkerProvisionerFromEnv } from "@/lib/runtime/provisioner/hetzner";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const workers = await listWorkers();
  return NextResponse.json({ workers });
}

export async function POST(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body = await request.json().catch(() => null);
  const parsed = parseCreateWorkerInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const provisioner = createHetznerWorkerProvisionerFromEnv();
  const worker = await provisioner.provision({
    name: parsed.value.name,
    region: parsed.value.region,
    size: parsed.value.serverType,
    capacity: parsed.value.capacity,
  });

  return NextResponse.json({ worker }, { status: 201 });
}
