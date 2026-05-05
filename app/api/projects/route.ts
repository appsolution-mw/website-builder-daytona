import { NextResponse, type NextRequest } from "next/server";
import type { AgentRuntime as PrismaAgentRuntime, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createInstallationAccessToken } from "@/lib/github/app";
import { projectSourceFromCreateBody } from "@/lib/projects/source";
import { createRuntime } from "@/lib/runtime";
import {
  AGENT_RUNTIME_OPTIONS,
  dbRuntimeToProtocol,
  isAgentRuntime,
  protocolRuntimeToDb,
} from "@/lib/agents/runtime";
import { serializeSession, sessionSelect } from "@/lib/agents/session-runtime-state";
import { getEffectiveAgentConfig } from "@/lib/agent-config/db";
import { materializeOpenHandsFiles } from "@/lib/agent-config/materialize";
import { AgentError } from "@/lib/runtime/worker-pool/types";
import { ensureDefaultWorkspaceForUser } from "@/lib/workspaces/access";

const SPAWN_TIMEOUT_MS = 120_000;
const MAX_ENV_BYTES = 64 * 1024;
const SANITIZED_PROVISIONING_ERROR = "sandbox provisioning failed";
const SANDBOX_IMAGE_NOT_FOUND_ERROR = "sandbox image not found";
const WORKER_AGENT_AUTH_ERROR = "worker agent authentication failed";
const WORKER_AGENT_UNAVAILABLE_ERROR = "worker agent unavailable";
const SANDBOX_PORTS_EXHAUSTED_ERROR = "sandbox port range exhausted";
const SANDBOX_SPAWN_TIMEOUT_ERROR = "sandbox provisioning timed out";

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
  sourceType: true,
  githubOwner: true,
  githubRepo: true,
  githubBaseBranch: true,
  githubWorkingBranch: true,
  githubImportSha: true,
  githubPullRequestUrl: true,
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
  sourceType: string;
  githubOwner: string | null;
  githubRepo: string | null;
  githubBaseBranch: string | null;
  githubWorkingBranch: string | null;
  githubImportSha: string | null;
  githubPullRequestUrl: string | null;
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

function contentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`spawn timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function safeProvisioningError(error: unknown): string {
  if (error instanceof AgentError) {
    if (error.errorCode === "image-not-found") return SANDBOX_IMAGE_NOT_FOUND_ERROR;
    if (error.errorCode === "hmac-invalid" || error.statusCode === 401) return WORKER_AGENT_AUTH_ERROR;
    if (error.errorCode === "port-exhausted") return SANDBOX_PORTS_EXHAUSTED_ERROR;
  }
  if (error instanceof Error) {
    if (error.message.startsWith("spawn timeout after ")) return SANDBOX_SPAWN_TIMEOUT_ERROR;
    if (error.name === "AbortError" || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(error.message)) {
      return WORKER_AGENT_UNAVAILABLE_ERROR;
    }
  }
  return SANITIZED_PROVISIONING_ERROR;
}

export async function GET(request: NextRequest) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const projects = await prisma.project.findMany({
    where: { ownerId: currentUser.user.id },
    orderBy: { lastActive: "desc" },
    select: projectSelect,
  });
  return NextResponse.json({
    projects: projects.map((project) => serializeProject(project)),
  });
}

export async function POST(request: NextRequest) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    runtime?: unknown;
    environmentContent?: unknown;
  } & Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const runtime = typeof body.runtime === "string" && isAgentRuntime(body.runtime)
    ? body.runtime
    : "claude-code";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (
    "environmentContent" in body &&
    body.environmentContent !== undefined &&
    typeof body.environmentContent !== "string"
  ) {
    return NextResponse.json(
      { error: "environmentContent must be a string" },
      { status: 400 },
    );
  }

  const initialEnvironmentContent = typeof body.environmentContent === "string" &&
    body.environmentContent.length > 0
    ? body.environmentContent
    : undefined;
  if (
    initialEnvironmentContent !== undefined &&
    contentByteLength(initialEnvironmentContent) > MAX_ENV_BYTES
  ) {
    return NextResponse.json({ error: "content is too large" }, { status: 413 });
  }

  let source;
  try {
    source = projectSourceFromCreateBody(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid source" },
      { status: 400 },
    );
  }

  const githubRepository = source.type === "github"
    ? await prisma.gitHubRepository.findFirst({
        where: {
          id: source.repositoryId,
          installation: { ownerId: currentUser.user.id },
        },
        include: { installation: true },
      })
    : null;
  if (source.type === "github" && !githubRepository) {
    return NextResponse.json({ error: "repository not found" }, { status: 404 });
  }

  const workspace = await ensureDefaultWorkspaceForUser({
    id: currentUser.user.id,
    email: currentUser.user.email ?? "",
    name: currentUser.user.name,
  });

  let project: Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
  let projectEnvContent: string | undefined;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          ownerId: currentUser.user.id,
          workspaceId: workspace.id,
          status: "PROVISIONING",
          agentRuntime: protocolRuntimeToDb(runtime),
          desiredRuntime: protocolRuntimeToDb(runtime),
          sourceType: source.type === "github" ? "GITHUB" : "TEMPLATE",
          githubInstallationId: githubRepository?.installationId ?? null,
          githubRepositoryId: githubRepository?.id ?? null,
          githubOwner: githubRepository?.ownerLogin ?? null,
          githubRepo: githubRepository?.name ?? null,
          githubBaseBranch: source.type === "github" ? source.branch : null,
          sessions: {
            create: {
              title: "Main chat",
              defaultRuntime: protocolRuntimeToDb(runtime),
            },
          },
        },
        select: projectSelect,
      });

      let projectEnvContent: string | undefined;
      if (initialEnvironmentContent !== undefined) {
        const environment = await tx.projectEnvironment.upsert({
          where: { projectId: project.id },
          create: { projectId: project.id, content: initialEnvironmentContent },
          update: { content: initialEnvironmentContent },
          select: { content: true },
        });
        projectEnvContent = environment.content;
      }

      return { project, projectEnvContent };
    });
    project = created.project;
    projectEnvContent = created.projectEnvContent;
  } catch {
    return NextResponse.json(
      { error: "project creation failed" },
      { status: 500 },
    );
  }

  // Note: SessionRuntimeState is intentionally NOT pre-created here.
  // The frontend treats "row exists" as "resume an existing claude session";
  // a fresh sandbox container has no session to resume, so the first turn must
  // create one. The row is inserted by the broker's `agent.session` event
  // handler after claude reports the new session_id at the end of turn 1.

  const sandboxRuntime = createRuntime();
  try {
    const spawnSource = source.type === "github" && githubRepository
      ? {
          type: "github" as const,
          installationId: githubRepository.installation.installationId.toString(),
          owner: githubRepository.ownerLogin,
          repo: githubRepository.name,
          branch: source.branch,
          token: (await createInstallationAccessToken(
            githubRepository.installation.installationId,
          )).token,
        }
      : { type: "template" as const };
    const openhandsFiles = materializeOpenHandsFiles(await getEffectiveAgentConfig(project.id));
    const info = await withTimeout(
      sandboxRuntime.spawnProjectSandbox({
        projectId: project.id,
        source: spawnSource,
        projectEnvContent,
        openhandsFiles,
      }),
      SPAWN_TIMEOUT_MS,
    );

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "RUNNING",
        sandboxId: info.sandboxId,
        brokerUrl: info.brokerUrl,
        brokerPreviewToken: info.brokerPreviewToken,
        previewUrl: info.previewUrl,
      },
      select: projectSelect,
    });
    return NextResponse.json({
      project: serializeProject(updated),
    }, { status: 201 });
  } catch (error) {
    const message = safeProvisioningError(error);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "DESTROYED",
        provisioningError: message,
      },
    });
    return NextResponse.json(
      {
        error: "provisioning failed",
        project: updated,
        message,
      },
      { status: 500 },
    );
  }
}
