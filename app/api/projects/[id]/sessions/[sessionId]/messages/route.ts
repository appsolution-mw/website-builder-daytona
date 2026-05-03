import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { isAgentRuntime, protocolRuntimeToDb } from "@/lib/agents/runtime";

const TITLE_FROM_PROMPT_MAX = 56;

function titleFromPrompt(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= TITLE_FROM_PROMPT_MAX) return compact || "New chat";
  return `${compact.slice(0, TITLE_FROM_PROMPT_MAX - 3)}...`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id, sessionId } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      project: { id, ownerId: currentUser.user.id },
    },
    select: {
      id: true,
      projectId: true,
      title: true,
      _count: { select: { messages: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    role?: unknown;
    content?: unknown;
    turnId?: unknown;
    agentId?: unknown;
    runtime?: unknown;
    provider?: unknown;
    modelId?: unknown;
  };
  const role = body.role === "USER" || body.role === "AGENT" || body.role === "SYSTEM"
    ? body.role
    : null;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!role || !content) {
    return NextResponse.json({ error: "role and content are required" }, { status: 400 });
  }

  const turnId = typeof body.turnId === "string" && body.turnId ? body.turnId : null;
  const agentId = typeof body.agentId === "string" && body.agentId ? body.agentId : null;
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? protocolRuntimeToDb(body.runtime)
    : null;
  const provider = typeof body.provider === "string" && body.provider ? body.provider : null;
  const modelId = typeof body.modelId === "string" && body.modelId ? body.modelId : null;
  const now = new Date();
  const shouldRetitle =
    role === "USER" &&
    session._count.messages === 0 &&
    (session.title === "New chat" || session.title === "Main chat" || session.title === "untitled");

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        projectId: session.projectId,
        sessionId: session.id,
        role,
        content,
        turnId,
        agentId,
        runtime,
        provider,
        modelId,
      },
      select: {
        id: true,
        role: true,
        content: true,
        turnId: true,
        agentId: true,
        runtime: true,
        provider: true,
        modelId: true,
        createdAt: true,
      },
    }),
    prisma.session.update({
      where: { id: session.id },
      data: {
        lastMessageAt: now,
        ...(shouldRetitle ? { title: titleFromPrompt(content) } : {}),
      },
    }),
  ]);

  return NextResponse.json({ message }, { status: 201 });
}
