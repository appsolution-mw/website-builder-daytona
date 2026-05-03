import { createSign } from "node:crypto";

import type {
  GitHubInstallationResponse,
  GitHubInstallationTokenResponse,
} from "@/lib/github/types";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE_URL = "https://api.github.com";
const JWT_TTL_SECONDS = 9 * 60;

export type GitHubAppConfig = {
  appId: string;
  clientId: string;
  privateKey: string;
  slug: string;
  webhookSecret: string;
};

export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n").trim();
}

export function getGitHubAppConfig(): GitHubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID ?? "",
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? "",
    privateKey: normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY ?? ""),
    slug: process.env.GITHUB_APP_SLUG ?? "",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  };
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createGitHubAppJwt(config = getGitHubAppConfig(), now = new Date()): string {
  if (!config.appId || !config.privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + JWT_TTL_SECONDS;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: issuedAt,
    exp: expiresAt,
    iss: config.appId,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(config.privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

async function githubJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
  }
  return await response.json() as T;
}

export async function getGitHubInstallation(
  installationId: string | number | bigint,
): Promise<GitHubInstallationResponse> {
  const jwt = createGitHubAppJwt();
  return githubJson<GitHubInstallationResponse>(`/app/installations/${installationId.toString()}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
}

export async function createInstallationAccessToken(
  installationId: string | number | bigint,
): Promise<GitHubInstallationTokenResponse> {
  const jwt = createGitHubAppJwt();
  return githubJson<GitHubInstallationTokenResponse>(
    `/app/installations/${installationId.toString()}/access_tokens`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
    },
  );
}

export function githubAppInstallUrl(config = getGitHubAppConfig()): string | null {
  if (!config.slug) return null;
  return `https://github.com/apps/${config.slug}/installations/new`;
}
