export type GitHubProfileForAuth = {
  id: string | number;
  login?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

function fallbackGitHubEmail(profile: GitHubProfileForAuth): string {
  return `github-${profile.id.toString()}@users.noreply.github.local`;
}

export function mapGitHubProfileToUser(profile: GitHubProfileForAuth): {
  name: string;
  email: string;
  image?: string;
  emailVerified?: boolean;
} {
  const email = typeof profile.email === "string" && profile.email.trim()
    ? profile.email.trim()
    : fallbackGitHubEmail(profile);
  const hasProviderEmail = email === profile.email?.trim();

  return {
    name: profile.name?.trim() || profile.login?.trim() || `GitHub ${profile.id.toString()}`,
    email,
    image: profile.avatar_url ?? undefined,
    ...(hasProviderEmail ? {} : { emailVerified: false }),
  };
}
