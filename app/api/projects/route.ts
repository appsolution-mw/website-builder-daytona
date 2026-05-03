import { NextResponse, type NextRequest } from "next/server";
import type { AgentRuntime as PrismaAgentRuntime } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { createRuntime } from "@/lib/runtime";
import {
  AGENT_RUNTIME_OPTIONS,
  dbRuntimeToProtocol,
  isAgentRuntime,
  protocolRuntimeToDb,
} from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const SPAWN_TIMEOUT_MS = 120_000;

const projectSelect = {
  id: true,
  name: true,
  status: true,
  agentRuntime: true,
  desiredRuntime: true,
  runtimeSwitchStatus: true,
  runtimeGeneration: true,
  createdAt: true,
  lastActive: true,
  brokerUrl: true,
  previewUrl: true,
  sessions: {
    take: 1,
    orderBy: { createdAt: "asc" },
    select: sessionSelect,
  },
} as const;

function serializeProject(project: {
  id: string;
  name: string;
  status: string;
  agentRuntime: PrismaAgentRuntime;
  desiredRuntime: PrismaAgentRuntime;
  runtimeSwitchStatus: string;
  runtimeGeneration: number;
  createdAt: Date;
  lastActive: Date;
  brokerUrl: string | null;
  previewUrl: string | null;
  sessions?: Array<{
    id: string;
    title: string;
    defaultRuntime: PrismaAgentRuntime;
    createdAt: Date;
    lastMessageAt: Date;
    runtimeStates: Array<{
      runtime: PrismaAgentRuntime;
      providerSessionId: string;
      modelId: string | null;
      lastUsedAt: Date;
    }>;
    _count: { messages: number };
  }>;
}) {
  const [chatSession] = project.sessions ?? [];
  return {
    ...project,
    agentRuntime: dbRuntimeToProtocol(project.agentRuntime),
    desiredRuntime: dbRuntimeToProtocol(project.desiredRuntime),
    availableRuntimes: AGENT_RUNTIME_OPTIONS,
    ...(chatSession ? { chatSession: serializeSession(chatSession) } : {}),
  };
}

async function projectEnvContent(projectId: string): Promise<string | undefined> {
  const row = await prisma.projectEnvironment.findUnique({
    where: { projectId },
    select: { content: true },
  });
  return row?.content || undefined;
}

export async function GET() {
  const projects = await prisma.project.findMany({
    where: { ownerId: DEV_USER_ID },
    orderBy: { lastActive: "desc" },
    select: projectSelect,
  });
  return NextResponse.json({
    projects: projects.map((project) => serializeProject(project)),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; runtime?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? body.runtime
    : "claude-code";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // GitHub clone vars are only needed by the Daytona path (which downloads
  // the builder repo as a tarball into the sandbox at boot). The worker-pool
  // path uses pre-built images and ignores them.
  const runtimeMode = process.env.RUNTIME_MODE ?? `daytona-${process.env.DAYTONA_MODE ?? "cloud"}`;
  const needsGitHubVars = runtimeMode.startsWith("daytona-");
  const cloneToken = process.env.GITHUB_CLONE_TOKEN ?? "";
  const repoOwner = process.env.GITHUB_REPO_OWNER ?? "";
  const repoName = process.env.GITHUB_REPO_NAME ?? "";
  if (needsGitHubVars && (!cloneToken || !repoOwner || !repoName)) {
    return NextResponse.json(
      { error: "server missing GITHUB_CLONE_TOKEN/OWNER/NAME" },
      { status: 500 },
    );
  }

  const project = await prisma.project.create({
    data: {
      name,
      ownerId: DEV_USER_ID,
      status: "PROVISIONING",
      agentRuntime: protocolRuntimeToDb(runtime),
      desiredRuntime: protocolRuntimeToDb(runtime),
      sessions: {
        create: {
          title: "Main chat",
          defaultRuntime: protocolRuntimeToDb(runtime),
        },
      },
    },
    select: projectSelect,
  });

  // Note: SessionRuntimeState is intentionally NOT pre-created here.
  // The frontend treats "row exists" as "resume an existing claude session";
  // a fresh sandbox container has no session to resume, so the first turn must
  // create one. The row is inserted by the broker's `agent.session` event
  // handler after claude reports the new session_id at the end of turn 1.

  const sandboxRuntime = createRuntime();
  try {
    const info = await Promise.race([
      sandboxRuntime.spawnProjectSandbox({
        projectId: project.id,
        cloneToken,
        repoOwner,
        repoName,
        projectEnvContent: await projectEnvContent(project.id),
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
      select: projectSelect,
    });
    return NextResponse.json({
      project: serializeProject(updated),
    }, { status: 201 });
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
