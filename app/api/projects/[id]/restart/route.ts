import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { createDaytonaRuntime, createRuntime, type Runtime } from "@/lib/runtime";
import type { ProjectSource } from "@/lib/runtime/types";
import { createInstallationAccessToken } from "@/lib/github/app";
import { getEffectiveAgentConfig } from "@/lib/agent-config/db";
import { materializeOpenHandsFiles } from "@/lib/agent-config/materialize";

const SANITIZED_RESTART_ERROR = "sandbox restart failed";

type RestartProject = {
  id: string;
  status: string;
  daytonaSandboxId: string | null;
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
      daytonaSandboxId: true,
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
  const runtime = runtimeForSandbox(project.daytonaSandboxId);
  const openhandsFiles = materializeOpenHandsFiles(await getEffectiveAgentConfig(project.id));

  try {
    if (project.daytonaSandboxId) {
      await runtime.destroyProjectSandbox(project.daytonaSandboxId);
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
        daytonaSandboxId: info.sandboxId,
        brokerUrl: info.brokerUrl,
        brokerPreviewToken: info.brokerPreviewToken,
        previewUrl: info.previewUrl,
        provisioningError: null,
      },
    });
    return NextResponse.json({ project: updated });
  } catch {
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        status: "DESTROYED",
        brokerUrl: null,
        brokerPreviewToken: null,
        previewUrl: null,
        provisioningError: SANITIZED_RESTART_ERROR,
      },
    });
    return NextResponse.json(
      {
        error: "restart failed",
        project: updated,
        message: SANITIZED_RESTART_ERROR,
      },
      { status: 500 },
    );
  }
}
