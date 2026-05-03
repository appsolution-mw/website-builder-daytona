export type GitHubAccountType = "User" | "Organization";

export type GitHubInstallationResponse = {
  id: number;
  account: {
    login: string;
    type: GitHubAccountType | string;
    avatar_url?: string | null;
  } | null;
  repository_selection: string;
  suspended_at?: string | null;
};

export type GitHubInstallationTokenResponse = {
  token: string;
  expires_at: string;
};

export type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
  };
};

export type GitHubBranchResponse = {
  name: string;
  commit: {
    sha: string;
  };
};
