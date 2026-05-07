import { NextResponse, type NextRequest } from "next/server";
import type { AgentRuntime as PrismaAgentRuntime, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createInstallationAccessToken } from "@/lib/github/app";
import { projectSourceFromCreateBody } from "@/lib/projects/source";
import { createRuntime } from "@/lib/runtime";
import { isRuntimeError } from "@/lib/runtime/errors";
import type { Runtime, SandboxInfo } from "@/lib/runtime/types";
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
import { createProjectPublicSlugCandidate } from "@/lib/routing/project-slug";

const SPAWN_TIMEOUT_MS = 120_000;
const MAX_ENV_BYTES = 64 * 1024;
const SANITIZED_PROVISIONING_ERROR = "sandbox provisioning failed";
const SANDBOX_IMAGE_NOT_FOUND_ERROR = "sandbox image not found";
const WORKER_AGENT_AUTH_ERROR = "worker agent authentication failed";
const WORKER_AGENT_UNAVAILABLE_ERROR = "worker agent unavailable";
const SANDBOX_PORTS_EXHAUSTED_ERROR = "sandbox port range exhausted";
const SANDBOX_SPAWN_TIMEOUT_ERROR = "sandbox provisioning timed out";
const NO_WORKER_CAPACITY_ERROR = "no worker capacity";
const NO_WORKER_CAPACITY_FALLBACK_MESSAGE = "No worker capacity is currently available";

const projectSelect = {
  id: true,
  name: true,
  publicSlug: true,
  status: true,
  agentRuntime: true,
  desiredRuntime: true,
  runtimeSwitchStatus: true,
  runtimeGeneration: true,
  createdAt: true,
  lastActive: true,
  brokerUrl: true,
  brokerReady: true,
  brokerReadyAt: true,
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
  publicSlug: string | null;
  status: string;
  agentRuntime: PrismaAgentRuntime;
  desiredRuntime: PrismaAgentRuntime;
  runtimeSwitchStatus: string;
  runtimeGeneration: number;
  createdAt: Date;
  lastActive: Date;
  brokerUrl: string | null;
  brokerReady: boolean;
  brokerReadyAt: Date | null;
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

async function withSpawnTimeout(
  operation: Promise<SandboxInfo>,
  runtime: Pick<Runtime, "destroyProjectSandbox">,
  timeoutMs: number,
): Promise<SandboxInfo> {
  try {
    return await withTimeout(operation, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("spawn timeout after ")) {
      operation
        .then((info) => runtime.destroyProjectSandbox(info.sandboxId))
        .catch(() => undefined);
    }
    throw error;
  }
}

async function availablePublicSlugCandidate(
  base: string,
  startIndex: number,
): Promise<{ publicSlug: string; index: number } | null> {
  for (let i = startIndex; i < 100; i += 1) {
    const candidate = publicSlugCandidate(base, i);
    const existing = await prisma.project.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!existing) return { publicSlug: candidate, index: i };
  }
  return null;
}

function publicSlugCandidate(base: string, index: number): string {
  return index === 0 ? base : `${base}-${index + 1}`;
}

function isPublicSlugUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes("publicSlug");
  return typeof target === "string" && target.includes("publicSlug");
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

function noWorkerCapacityMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return NO_WORKER_CAPACITY_FALLBACK_MESSAGE;
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

  let project: Prisma.ProjectGetPayload<{ select: typeof projectSelect }> | undefined;
  let projectEnvContent: string | undefined;
  try {
    const basePublicSlug = createProjectPublicSlugCandidate(name);
    let nextSlugIndex = 0;
    while (nextSlugIndex < 100) {
      const candidate = await availablePublicSlugCandidate(basePublicSlug, nextSlugIndex);
      if (!candidate) break;
      try {
        const created = await prisma.$transaction(async (tx) => {
          const project = await tx.project.create({
            data: {
              name,
              publicSlug: candidate.publicSlug,
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
        break;
      } catch (error) {
        if (isPublicSlugUniqueConstraintError(error)) {
          nextSlugIndex = candidate.index + 1;
          continue;
        }
        throw error;
      }
    }
    if (!project) throw new Error("could not allocate public slug");
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

  // `createRuntime()` reads runtime env (e.g. WATCHTOWER_HTTP_API_TOKEN). If
  // any required var is missing the constructor throws synchronously — keep
  // it inside the try so the catch flips the project to DESTROYED with a
  // useful provisioningError instead of stranding it in PROVISIONING.
  try {
    const sandboxRuntime = createRuntime();
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
    const info = await withSpawnTimeout(
      sandboxRuntime.spawnProjectSandbox({
        projectId: project.id,
        source: spawnSource,
        projectEnvContent,
        openhandsFiles,
      }),
      sandboxRuntime,
      SPAWN_TIMEOUT_MS,
    );

    let updated: Parameters<typeof serializeProject>[0];
    try {
      updated = await prisma.project.update({
        where: { id: project.id },
        data: {
          status: "RUNNING",
          sandboxId: info.sandboxId,
          brokerUrl: info.brokerUrl,
          brokerPreviewToken: info.brokerPreviewToken,
          previewUrl: info.previewUrl,
          // Worker-agent flips this to true once the in-container broker
          // answers /health. In-process runtimes (fake) return brokerReady=true
          // immediately. UI gates Open + workspace on this flag.
          brokerReady: info.brokerReady ?? false,
          brokerReadyAt: info.brokerReady ? new Date() : null,
        },
        select: projectSelect,
      });
    } catch (error: unknown) {
      await sandboxRuntime.destroyProjectSandbox(info.sandboxId).catch(() => undefined);
      throw error;
    }
    return NextResponse.json({
      project: serializeProject(updated),
    }, { status: 201 });
  } catch (error) {
    console.error("[projects] sandbox provisioning failed", error);
    const isNoWorkerCapacity = isRuntimeError(error, "NO_WORKER_CAPACITY");
    const message = isNoWorkerCapacity
      ? noWorkerCapacityMessage(error)
      : safeProvisioningError(error);
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "DESTROYED",
        sandboxId: null,
        brokerUrl: null,
        brokerPreviewToken: null,
        previewUrl: null,
        provisioningError: message,
      },
    });
    return NextResponse.json(
      {
        error: isNoWorkerCapacity ? NO_WORKER_CAPACITY_ERROR : "provisioning failed",
        project: updated,
        message,
      },
      { status: isNoWorkerCapacity ? 409 : 500 },
    );
  }
}
