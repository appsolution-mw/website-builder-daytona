import { prisma } from "@/lib/db/client";
import { createInstallationAccessToken } from "@/lib/github/app";
import { pushProjectChanges } from "@/lib/projects/broker-git";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE_URL = "https://api.github.com";
const PR_BODY = "Changes prepared from Website Builder Daytona.";

export type ProjectPullRequestResult = {
  url: string;
  branch: string;
  commitSha: string;
};

export class ProjectPullRequestError extends Error {
  constructor(
    public readonly code:
      | "project_not_found"
      | "github_source_incomplete"
      | "project_busy"
      | "no_changes"
      | "github_api_failed"
      | "sandbox_push_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProjectPullRequestError";
  }
}

export function workingBranchForProject(args: { projectId: string; name: string }): string {
  const slug = args.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `wbd/${args.projectId}-${slug || "changes"}`;
}

export async function createProjectPullRequest(args: {
  userId: string;
  projectId: string;
  title?: string;
}): Promise<ProjectPullRequestResult> {
  const project = await prisma.project.findFirst({
    where: {
      id: args.projectId,
      sourceType: "GITHUB",
      OR: [
        { ownerId: args.userId },
        { workspace: { members: { some: { userId: args.userId } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      githubOwner: true,
      githubRepo: true,
      githubBaseBranch: true,
      githubWorkingBranch: true,
      githubInstallation: { select: { installationId: true } },
      queueState: { select: { state: true } },
    },
  });

  if (!project) {
    throw new ProjectPullRequestError("project_not_found", "project not found");
  }
  if (!project.githubInstallation || !project.githubOwner || !project.githubRepo || !project.githubBaseBranch) {
    throw new ProjectPullRequestError(
      "github_source_incomplete",
      "project is not connected to GitHub",
    );
  }
  if (project.queueState?.state === "RUNNING") {
    throw new ProjectPullRequestError(
      "project_busy",
      "project has an active agent run",
    );
  }

  const token = await createInstallationAccessToken(project.githubInstallation.installationId);
  const branch = project.githubWorkingBranch ?? workingBranchForProject({
    projectId: project.id,
    name: project.name,
  });
  const title = args.title?.trim() || `Website Builder changes for ${project.name}`;
  const pushResult = await pushProjectChanges({
    projectId: project.id,
    branch,
    commitMessage: title,
    remoteToken: token.token,
    owner: project.githubOwner,
    repo: project.githubRepo,
  });

  if (!pushResult.ok) {
    throw new ProjectPullRequestError(
      pushResult.reason === "no_changes" ? "no_changes" : "sandbox_push_failed",
      pushResult.message,
    );
  }

  const pullRequest = await githubJson<{ html_url: string }>({
    token: token.token,
    path: `/repos/${encodeURIComponent(project.githubOwner)}/${encodeURIComponent(project.githubRepo)}/pulls`,
    method: "POST",
    body: {
      title,
      head: branch,
      base: project.githubBaseBranch,
      body: PR_BODY,
    },
  });

  await prisma.project.update({
    where: { id: project.id },
    data: {
      githubWorkingBranch: branch,
      githubPullRequestUrl: pullRequest.html_url,
    },
  });

  return {
    url: pullRequest.html_url,
    branch,
    commitSha: pushResult.commitSha,
  };
}

async function githubJson<T>(args: {
  token: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${args.path}`, {
    method: args.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json",
      "x-github-api-version": GITHUB_API_VERSION,
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ProjectPullRequestError(
      "github_api_failed",
      `GitHub API ${response.status}: ${body || response.statusText}`,
    );
  }
  return await response.json() as T;
}
