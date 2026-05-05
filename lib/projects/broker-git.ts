import { prisma } from "@/lib/db/client";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import { resolveWorkerAgentClientConfig } from "@/lib/runtime/worker-pool";
import { AgentError } from "@/lib/runtime/worker-pool/types";

export type ProjectGitStatus = {
  hasChanges: boolean;
  entries: string[];
};

export type ProjectGitPushResult =
  | {
      ok: true;
      branch: string;
      commitSha: string;
    }
  | {
      ok: false;
      reason: "no_changes" | "git_error";
      message: string;
    };

export async function getProjectGitStatus(projectId: string): Promise<ProjectGitStatus> {
  const target = await agentTargetForProject(projectId);
  const status = await target.client.getProjectGitStatus(target.sandboxId, projectId);
  return {
    hasChanges: status.hasChanges,
    entries: status.porcelain,
  };
}

export async function pushProjectChanges(input: {
  projectId: string;
  owner: string;
  repo: string;
  branch: string;
  remoteToken: string;
  commitMessage: string;
}): Promise<ProjectGitPushResult> {
  const target = await agentTargetForProject(input.projectId);
  const remoteUrl = gitHubRemoteUrl({
    owner: input.owner,
    repo: input.repo,
  });
  try {
    const result = await target.client.pushProjectGitChanges(target.sandboxId, {
      projectId: input.projectId,
      remoteUrl,
      remoteAuth: {
        username: "x-access-token",
        password: input.remoteToken,
      },
      branch: input.branch,
      commitMessage: input.commitMessage,
    });
    if (result.ok) return result;
    return {
      ok: false,
      reason: "no_changes",
      message: "No workspace changes to save",
    };
  } catch (error) {
    return {
      ok: false,
      reason: "git_error",
      message: error instanceof AgentError ? error.message : "Git push failed",
    };
  }
}

function gitHubRemoteUrl(input: { owner: string; repo: string }): string {
  return `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}.git`;
}

async function agentTargetForProject(projectId: string): Promise<{
  sandboxId: string;
  client: ReturnType<typeof createAgentClient>;
}> {
  const sandbox = await prisma.workerSandbox.findFirst({
    where: { projectId, status: { not: "DESTROYED" } },
    select: {
      id: true,
      worker: { select: { tailscaleIp: true } },
    },
  });
  if (!sandbox) {
    throw new Error("project sandbox is not running");
  }
  return {
    sandboxId: sandbox.id,
    client: createAgentClient(resolveWorkerAgentClientConfig({
      worker: sandbox.worker,
    })),
  };
}
