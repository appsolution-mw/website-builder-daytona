import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { isAgentRuntime, protocolRuntimeToDb } from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

async function findProject(id: string) {
  return prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
    select: { id: true },
  });
}

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

  return NextResponse.json({ sessions: sessions.map(serializeSession) });
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

  const body = (await request.json().catch(() => ({}))) as { title?: unknown; runtime?: unknown };
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = rawTitle || "New chat";
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? body.runtime
    : null;

  const projectRuntime = await prisma.project.findUnique({
    where: { id: project.id },
    select: { agentRuntime: true },
  });
  const defaultRuntime = runtime ? protocolRuntimeToDb(runtime) : (projectRuntime?.agentRuntime ?? "CLAUDE_CODE");

  const session = await prisma.session.create({
    data: {
      projectId: project.id,
      title,
      defaultRuntime,
      runtimeStates: {
        create: {
          projectId: project.id,
          runtime: defaultRuntime,
          providerSessionId: randomUUID(),
        },
      },
    },
    select: sessionSelect,
  });

  return NextResponse.json({ session: serializeSession(session) }, { status: 201 });
}
