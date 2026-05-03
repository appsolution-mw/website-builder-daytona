import { prisma } from "@/lib/db/client";
import { createInstallationAccessToken } from "@/lib/github/app";
import type { GitHubBranchResponse, GitHubRepositoryResponse } from "@/lib/github/types";

const GITHUB_API_VERSION = "2022-11-28";

export type SerializedGitHubRepository = {
  id: string;
  githubRepoId: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type SerializedGitHubBranch = {
  name: string;
  sha: string;
};

function serializeRepository(repository: {
  id: string;
  githubRepoId: bigint;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}): SerializedGitHubRepository {
  return {
    id: repository.id,
    githubRepoId: repository.githubRepoId.toString(),
    ownerLogin: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    private: repository.private,
    defaultBranch: repository.defaultBranch,
  };
}

async function installationToken(installationId: bigint): Promise<string> {
  const token = await createInstallationAccessToken(installationId);
  return token.token;
}

async function githubInstallationJson<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return await response.json() as T;
}

export async function listInstallationRepositories(
  userId: string,
  installationRecordId: string,
): Promise<SerializedGitHubRepository[]> {
  const installation = await prisma.gitHubInstallation.findFirst({
    where: { id: installationRecordId, ownerId: userId },
  });
  if (!installation) {
    throw new Error("installation not found");
  }

  const token = await installationToken(installation.installationId);
  const payload = await githubInstallationJson<{ repositories: GitHubRepositoryResponse[] }>(
    token,
    "https://api.github.com/installation/repositories?per_page=100",
  );

  const repositories = await Promise.all(payload.repositories.map((repository) =>
    prisma.gitHubRepository.upsert({
      where: {
        installationId_githubRepoId: {
          installationId: installation.id,
          githubRepoId: BigInt(repository.id),
        },
      },
      create: {
        installationId: installation.id,
        githubRepoId: BigInt(repository.id),
        ownerLogin: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch,
        lastSyncedAt: new Date(),
      },
      update: {
        ownerLogin: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch,
        lastSyncedAt: new Date(),
      },
    })
  ));

  return repositories
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map(serializeRepository);
}

export async function listRepositoryBranches(
  userId: string,
  repositoryRecordId: string,
): Promise<SerializedGitHubBranch[]> {
  const repository = await prisma.gitHubRepository.findFirst({
    where: {
      id: repositoryRecordId,
      installation: { ownerId: userId },
    },
    include: { installation: true },
  });
  if (!repository) {
    throw new Error("repository not found");
  }

  const token = await installationToken(repository.installation.installationId);
  const branches = await githubInstallationJson<GitHubBranchResponse[]>(
    token,
    `https://api.github.com/repos/${repository.ownerLogin}/${repository.name}/branches?per_page=100`,
  );
  return branches.map((branch) => ({
    name: branch.name,
    sha: branch.commit.sha,
  }));
}
