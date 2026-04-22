import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      project: { id, ownerId: DEV_USER_ID },
    },
    select: {
      id: true,
      title: true,
      claudeSessionId: true,
      createdAt: true,
      lastMessageAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          turnId: true,
          agentId: true,
          createdAt: true,
        },
      },
      _count: { select: { messages: true } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    claudeSessionId?: unknown;
  };
  const claudeSessionId =
    typeof body.claudeSessionId === "string" ? body.claudeSessionId.trim() : "";
  if (!UUID_RE.test(claudeSessionId)) {
    return NextResponse.json({ error: "invalid claudeSessionId" }, { status: 400 });
  }

  const existing = await prisma.session.findFirst({
    where: {
      id: sessionId,
      project: { id, ownerId: DEV_USER_ID },
    },
    select: { id: true, claudeSessionId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (existing.claudeSessionId === claudeSessionId) {
    const session = await prisma.session.findUnique({
      where: { id: existing.id },
      select: sessionSelect,
    });
    return NextResponse.json({ session });
  }

  try {
    const session = await prisma.session.update({
      where: { id: existing.id },
      data: { claudeSessionId },
      select: sessionSelect,
    });
    return NextResponse.json({ session });
  } catch {
    return NextResponse.json({ error: "claudeSessionId already exists" }, { status: 409 });
  }
}
