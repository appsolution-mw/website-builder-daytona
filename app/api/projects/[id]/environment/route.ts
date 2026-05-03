import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const MAX_ENV_BYTES = 64 * 1024;

type RouteParams = {
  params: Promise<{ id: string }>;
};

type EnvironmentResponse = {
  content: string;
  updatedAt: string | null;
};

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

function environmentJson(body: EnvironmentResponse): NextResponse {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}

function contentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

async function findOwnedProject(projectId: string): Promise<{ id: string } | null> {
  return prisma.project.findFirst({
    where: { id: projectId, ownerId: devUserId() },
    select: { id: true },
  });
}

export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: devUserId() },
    select: {
      environment: {
        select: {
          content: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!project.environment) {
    return environmentJson({ content: "", updatedAt: null });
  }

  return environmentJson({
    content: project.environment.content,
    updatedAt: project.environment.updatedAt.toISOString(),
  });
}

export async function PUT(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const project = await findOwnedProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const content = body && typeof body === "object" && "content" in body
    ? (body as { content: unknown }).content
    : undefined;

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  if (contentByteLength(content) > MAX_ENV_BYTES) {
    return NextResponse.json({ error: "content is too large" }, { status: 413 });
  }

  const environment = await prisma.projectEnvironment.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, content },
    update: { content },
    select: { content: true, updatedAt: true },
  });

  return environmentJson({
    content: environment.content,
    updatedAt: environment.updatedAt.toISOString(),
  });
}
