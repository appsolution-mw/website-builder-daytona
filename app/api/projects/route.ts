import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { createDaytonaClient } from "@/lib/daytona";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const SPAWN_TIMEOUT_MS = 120_000;

export async function GET() {
  const projects = await prisma.project.findMany({
    where: { ownerId: DEV_USER_ID },
    orderBy: { lastActive: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      lastActive: true,
      brokerUrl: true,
      previewUrl: true,
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const cloneToken = process.env.GITHUB_CLONE_TOKEN;
  const repoOwner = process.env.GITHUB_REPO_OWNER;
  const repoName = process.env.GITHUB_REPO_NAME;
  if (!cloneToken || !repoOwner || !repoName) {
    return NextResponse.json(
      { error: "server missing GITHUB_CLONE_TOKEN/OWNER/NAME" },
      { status: 500 },
    );
  }

  const project = await prisma.project.create({
    data: { name, ownerId: DEV_USER_ID, status: "PROVISIONING" },
  });

  const daytona = createDaytonaClient();
  try {
    const info = await Promise.race([
      daytona.spawnProjectSandbox({
        projectId: project.id,
        cloneToken,
        repoOwner,
        repoName,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`spawn timeout after ${SPAWN_TIMEOUT_MS}ms`)),
          SPAWN_TIMEOUT_MS,
        ),
      ),
    ]);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "RUNNING",
        daytonaSandboxId: info.sandboxId,
        brokerUrl: info.brokerUrl,
        brokerPreviewToken: info.brokerPreviewToken,
        previewUrl: info.previewUrl,
      },
    });
    return NextResponse.json({ project: updated }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { status: "DESTROYED", provisioningError: message },
    });
    return NextResponse.json(
      { error: "provisioning failed", project: updated, message },
      { status: 500 },
    );
  }
}
