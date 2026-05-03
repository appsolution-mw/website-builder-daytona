import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "@better-auth/prisma-adapter";

import { mapGitHubProfileToUser } from "@/lib/auth/github-profile";
import { prisma } from "@/lib/db/client";

export const auth = betterAuth({
  appName: "Website Builder Daytona",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    modelName: "authSession",
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
      mapProfileToUser: mapGitHubProfileToUser,
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
