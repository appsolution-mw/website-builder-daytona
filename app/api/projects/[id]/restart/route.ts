import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createDaytonaRuntime, createRuntime, type Runtime } from "@/lib/runtime";
import { isRuntimeError } from "@/lib/runtime/errors";
import type { ProjectSource } from "@/lib/runtime/types";
import { createInstallationAccessToken } from "@/lib/github/app";
import { getEffectiveAgentConfig } from "@/lib/agent-config/db";
import { materializeOpenHandsFiles } from "@/lib/agent-config/materialize";

const SANITIZED_RESTART_ERROR = "sandbox restart failed";
const NO_WORKER_CAPACITY_ERROR = "no worker capacity";
const NO_WORKER_CAPACITY_FALLBACK_MESSAGE = "No worker capacity is currently available";

type RestartProject = {
  id: string;
  status: string;
  sandboxId: string | null;
  sourceType: string;
  githubOwner: string | null;
  githubRepo: string | null;
  githubBaseBranch: string | null;
  githubInstallation: { installationId: bigint } | null;
};

function runtimeForSandbox(sandboxId: string | null): Runtime {
  if (sandboxId?.startsWith("fake-")) {
    return createDaytonaRuntime("fake");
  }
  return createRuntime();
}

function noWorkerCapacityMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return NO_WORKER_CAPACITY_FALLBACK_MESSAGE;
}

async function restartSource(project: RestartProject): Promise<ProjectSource | NextResponse> {
  if (project.sourceType !== "GITHUB") {
    return { type: "template" };
  }

  if (!project.githubInstallation || !project.githubOwner || !project.githubRepo) {
    return NextResponse.json({ error: "github source is incomplete" }, { status: 409 });
  }

  const installationId = project.githubInstallation.installationId;
  const { token } = await createInstallationAccessToken(installationId);
  return {
    type: "github",
    installationId: installationId.toString(),
    owner: project.githubOwner,
    repo: project.githubRepo,
    branch: project.githubBaseBranch ?? "main",
    token,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
    select: {
      id: true,
      status: true,
      sandboxId: true,
      sourceType: true,
      githubOwner: true,
      githubRepo: true,
      githubBaseBranch: true,
      githubInstallation: { select: { installationId: true } },
    },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (project.status === "PROVISIONING") {
    return NextResponse.json({ error: "project is provisioning" }, { status: 409 });
  }

  const source = await restartSource(project);
  if (source instanceof NextResponse) return source;

  const environment = await prisma.projectEnvironment.findUnique({
    where: { projectId: project.id },
    select: { content: true },
  });
  const runtime = runtimeForSandbox(project.sandboxId);
  const openhandsFiles = materializeOpenHandsFiles(await getEffectiveAgentConfig(project.id));

  try {
    if (project.sandboxId) {
      await runtime.destroyProjectSandbox(project.sandboxId);
    }
    const info = await runtime.spawnProjectSandbox({
      projectId: project.id,
      source,
      projectEnvContent: environment?.content || undefined,
      openhandsFiles,
    });
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "RUNNING",
        sandboxId: info.sandboxId,
        brokerUrl: info.brokerUrl,
        brokerPreviewToken: info.brokerPreviewToken,
        previewUrl: info.previewUrl,
        provisioningError: null,
      },
    });
    return NextResponse.json({ project: updated });
  } catch (error) {
    const isNoWorkerCapacity = isRuntimeError(error, "NO_WORKER_CAPACITY");
    const message = isNoWorkerCapacity
      ? noWorkerCapacityMessage(error)
      : SANITIZED_RESTART_ERROR;
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "DESTROYED",
        brokerUrl: null,
        brokerPreviewToken: null,
        previewUrl: null,
        provisioningError: message,
      },
    });
    return NextResponse.json(
      {
        error: isNoWorkerCapacity ? NO_WORKER_CAPACITY_ERROR : "restart failed",
        project: updated,
        message,
      },
      { status: isNoWorkerCapacity ? 409 : 500 },
    );
  }
}
