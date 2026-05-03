export type SerializedGitHubInstallation = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
  suspendedAt: string | null;
};

export function serializeInstallation(installation: {
  id: string;
  installationId: bigint;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
  suspendedAt: Date | null;
}): SerializedGitHubInstallation {
  return {
    id: installation.id,
    installationId: installation.installationId.toString(),
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    accountAvatarUrl: installation.accountAvatarUrl,
    repositorySelection: installation.repositorySelection,
    suspendedAt: installation.suspendedAt?.toISOString() ?? null,
  };
}
