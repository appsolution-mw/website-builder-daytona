import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

async function findProject(id: string) {
  return prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
    select: { id: true },
  });
}

const sessionSelect = {
  id: true,
  title: true,
  claudeSessionId: true,
  createdAt: true,
  lastMessageAt: true,
  _count: { select: { messages: true } },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sessions = await prisma.session.findMany({
    where: { projectId: project.id },
    orderBy: { lastMessageAt: "desc" },
    select: sessionSelect,
  });

  return NextResponse.json({ sessions });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await findProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { title?: unknown };
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = rawTitle || "New chat";

  const session = await prisma.session.create({
    data: {
      projectId: project.id,
      title,
      claudeSessionId: randomUUID(),
    },
    select: sessionSelect,
  });

  return NextResponse.json({ session }, { status: 201 });
}
