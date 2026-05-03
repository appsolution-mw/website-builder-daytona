import { prisma } from "@/lib/db/client";
import { getGitHubInstallation } from "@/lib/github/app";
import {
  serializeInstallation,
  type SerializedGitHubInstallation,
} from "@/lib/github/serializers";

export async function listUserInstallations(userId: string): Promise<SerializedGitHubInstallation[]> {
  const installations = await prisma.gitHubInstallation.findMany({
    where: { ownerId: userId },
    orderBy: { accountLogin: "asc" },
  });
  return installations.map(serializeInstallation);
}

export async function upsertUserInstallation(userId: string, installationId: string) {
  const numericInstallationId = BigInt(installationId);
  const installation = await getGitHubInstallation(numericInstallationId);
  if (!installation.account) {
    throw new Error("GitHub installation is missing an account");
  }

  return prisma.gitHubInstallation.upsert({
    where: {
      ownerId_installationId: {
        ownerId: userId,
        installationId: numericInstallationId,
      },
    },
    create: {
      ownerId: userId,
      installationId: numericInstallationId,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      accountAvatarUrl: installation.account.avatar_url ?? null,
      repositorySelection: installation.repository_selection,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    },
    update: {
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      accountAvatarUrl: installation.account.avatar_url ?? null,
      repositorySelection: installation.repository_selection,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    },
  });
}
