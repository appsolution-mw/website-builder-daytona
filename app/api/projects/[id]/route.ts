import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createDaytonaClient } from "@/lib/daytona";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (project.daytonaSandboxId) {
    const daytona = createDaytonaClient();
    try {
      await daytona.destroyProjectSandbox(project.daytonaSandboxId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[api] destroy sandbox ${project.daytonaSandboxId} failed: ${message}`);
      // Continue — fall through to marking the project DESTROYED
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { status: "DESTROYED", brokerUrl: null, brokerPreviewToken: null, previewUrl: null },
  });

  return new NextResponse(null, { status: 204 });
}
