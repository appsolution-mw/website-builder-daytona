# GitHub Auth Repo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Better Auth login, GitHub App installation-based private repo import, sandbox boot from selected repos, and explicit branch/PR save-back.

**Architecture:** Better Auth becomes the session source for app users while GitHub App installation tokens are generated server-side for repository access. Project creation gains a source model (`template` or `github`), and the existing runtime/sandbox boot path receives a per-project source contract instead of global GitHub clone variables. GitHub API logic lives in focused `lib/github/*` services; route handlers stay thin and scope all data by the current Better Auth user.

**Tech Stack:** Next.js 16 App Router Route Handlers and `proxy.ts`, React 19, TypeScript, Prisma 7/PostgreSQL, Better Auth, GitHub REST API via `fetch`, existing worker-pool and Daytona runtime abstractions, Vitest.

---

## File Structure

Create:

- `lib/auth.ts` - Better Auth server configuration.
- `lib/auth-client.ts` - Better Auth React client.
- `lib/auth/current-user.ts` - required-session helper for routes/pages.
- `app/api/auth/[...all]/route.ts` - Better Auth route handler.
- `app/sign-in/page.tsx` - compact sign-in/sign-up page.
- `proxy.ts` - Next.js 16 route protection redirect boundary.
- `lib/github/types.ts` - GitHub DTOs and internal types.
- `lib/github/app.ts` - GitHub App JWT and installation token helpers.
- `lib/github/installations.ts` - installation callback validation and persistence.
- `lib/github/repositories.ts` - repository and branch listing.
- `lib/github/pull-requests.ts` - branch, commit, and PR operations.
- `lib/github/__tests__/app.test.ts`
- `lib/github/__tests__/installations.test.ts`
- `lib/github/__tests__/repositories.test.ts`
- `lib/github/__tests__/pull-requests.test.ts`
- `lib/projects/source.ts` - maps DB project source data to runtime spawn input.
- `lib/projects/__tests__/source.test.ts`
- `app/api/github/installations/route.ts`
- `app/api/github/installations/[installationId]/repositories/route.ts`
- `app/api/github/repositories/[repositoryId]/branches/route.ts`
- `app/api/github/callback/route.ts`
- `app/api/projects/[id]/pull-request/route.ts`
- `container/sandbox/broker/src/git-handlers.ts` - broker-side git status/commit/push commands.
- `container/sandbox/broker/tests/git-handlers.test.ts` - broker git command tests with temporary repositories.

Modify:

- `package.json` - add auth dependencies.
- `pnpm-lock.yaml` - dependency lock update.
- `.env.example` - Better Auth and GitHub App env vars.
- `prisma/schema.prisma` - Better Auth schema, GitHub installation/repo models, project source fields.
- `prisma/migrations/*/migration.sql` - generated migration.
- `prisma/seed.ts` - keep explicit dev user fallback aligned with Better Auth user shape.
- `app/layout.tsx` - metadata stays compatible with the sign-in flow.
- `app/page.tsx` - dashboard sign-out, GitHub connection, repo import flow.
- `app/usage/page.tsx` - current-user scoping.
- `app/project/[id]/page.tsx` - source metadata and PR action area.
- `app/api/projects/route.ts` - current-user scoping and GitHub-backed create.
- `app/api/projects/[id]/route.ts` - current-user scoping.
- `app/api/projects/[id]/models/route.ts` - current-user scoping.
- `app/api/projects/[id]/next-devtools/route.ts` - current-user scoping.
- `app/api/projects/[id]/usage/route.ts` - current-user scoping.
- `app/api/projects/[id]/sessions/route.ts` - current-user scoping.
- `app/api/projects/[id]/sessions/[sessionId]/route.ts` - current-user scoping.
- `app/api/projects/[id]/sessions/[sessionId]/messages/route.ts` - current-user scoping.
- `lib/runtime/types.ts` - replace clone fields with `ProjectSource`.
- `lib/runtime/daytona/cloud.ts` - accept per-project GitHub source.
- `lib/runtime/daytona/fake.ts` - accept new source contract.
- `lib/runtime/worker-pool/runtime.ts` - pass source env to sandbox.
- `worker-agent/src/docker.ts` - ensure source env is forwarded, if env allowlist exists.
- `container/sandbox/entrypoint.sh` - clone GitHub repo or seed template.
- `packages/protocol/src/index.ts` - add server-to-broker git commit/push messages.
- `container/sandbox/broker/src/ws-server.ts` - handle git commit/push messages.
- Existing route tests under `app/api/**/__tests__` - replace `DEV_USER_ID` assumptions with auth helper mocking.

Reference docs already checked:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
- `docs/superpowers/specs/2026-05-03-github-auth-repo-integration-design.md`

## Delegation Strategy

This implementation should use sub-agents because it has independent slices with disjoint write areas:

- Auth/schema worker: `lib/auth*`, auth route, Prisma auth models, session helper, route scoping helper.
- GitHub service worker: `lib/github/*` and related unit tests.
- Runtime worker: `lib/runtime/*`, `container/sandbox/entrypoint.sh`, worker-agent env forwarding tests.
- UI/API worker: dashboard import flow, project route DTOs, PR route, workspace PR action.

Each worker is not alone in the codebase and must not revert unrelated edits. Merge by task order below, not all at once.

---

### Task 1: Add Better Auth Dependencies, Config, and Auth Route

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `lib/auth.ts`
- Create: `lib/auth-client.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm add better-auth @better-auth/prisma-adapter
```

Expected: `package.json` contains `better-auth` and `@better-auth/prisma-adapter`; `pnpm-lock.yaml` changes.

- [ ] **Step 2: Create Better Auth server config**

Create `lib/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/db/client";

export const auth = betterAuth({
  appName: "Website Builder Daytona",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
```

- [ ] **Step 3: Create Better Auth client**

Create `lib/auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

- [ ] **Step 4: Create App Router auth route**

Create `app/api/auth/[...all]/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 5: Add env docs**

Add to `.env.example` near the database/user settings:

```dotenv
# Better Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

# GitHub App repository access
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

- [ ] **Step 6: Verify auth route compiles**

Run:

```bash
pnpm lint
```

Expected: either PASS or a focused type/import error in the new Better Auth import paths. If the Prisma adapter import differs in the installed package, inspect `node_modules/better-auth` and `node_modules/@better-auth/prisma-adapter`, adjust `lib/auth.ts`, and rerun.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example lib/auth.ts lib/auth-client.ts app/api/auth/[...all]/route.ts
git commit -m "feat: add better auth setup for T-20260503-006"
```

---

### Task 2: Generate and Merge Better Auth Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_better_auth_and_github_sources/migration.sql`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Generate Better Auth Prisma schema preview**

Run:

```bash
pnpm exec @better-auth/cli generate --config ./lib/auth.ts
```

Expected: generated Prisma model output for Better Auth user/session/account/verification tables. Save the output in terminal scrollback for manual merge; do not blindly replace the existing schema.

- [ ] **Step 2: Merge user shape into `prisma/schema.prisma`**

Modify `model User` so it satisfies Better Auth and preserves project ownership:

```prisma
model User {
  id            String   @id
  name          String?
  email         String   @unique
  emailVerified Boolean  @default(false)
  image         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  accounts      Account[]
  sessions      AuthSession[]
  projects      Project[]
  githubInstallations GitHubInstallation[]
}
```

Use the exact additional fields generated by the Better Auth CLI if they differ, but keep `projects` and `githubInstallations` relations.

- [ ] **Step 3: Add Better Auth account/session/verification models**

Add models using names that do not conflict with existing `Session` chat model. Use `AuthSession` for Better Auth sessions:

```prisma
model AuthSession {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
}
```

If the CLI generated different required fields for the installed Better Auth version, adapt to the generated output while preserving the `AuthSession` rename. Configure `lib/auth.ts` model mapping if Better Auth expects the model name `session`.

- [ ] **Step 4: Add GitHub installation and repository models**

Add:

```prisma
model GitHubInstallation {
  id                  String   @id @default(cuid())
  ownerId             String
  owner               User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  installationId      BigInt
  accountLogin        String
  accountType         String
  accountAvatarUrl    String?
  repositorySelection String
  suspendedAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  repositories        GitHubRepository[]
  projects            Project[]

  @@unique([ownerId, installationId])
  @@index([installationId])
}

model GitHubRepository {
  id             String             @id @default(cuid())
  installationId String
  installation   GitHubInstallation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  githubRepoId   BigInt
  ownerLogin     String
  name           String
  fullName       String
  private        Boolean
  defaultBranch  String
  lastSyncedAt   DateTime?

  projects       Project[]

  @@unique([installationId, githubRepoId])
  @@index([fullName])
}
```

- [ ] **Step 5: Add project source enum and fields**

Add enum:

```prisma
enum ProjectSourceType {
  TEMPLATE
  GITHUB
}
```

Modify `model Project`:

```prisma
  sourceType           ProjectSourceType @default(TEMPLATE)
  githubInstallationId String?
  githubInstallation   GitHubInstallation? @relation(fields: [githubInstallationId], references: [id], onDelete: SetNull)
  githubRepositoryId   String?
  githubRepository     GitHubRepository? @relation(fields: [githubRepositoryId], references: [id], onDelete: SetNull)
  githubOwner          String?
  githubRepo           String?
  githubBaseBranch     String?
  githubWorkingBranch  String?
  githubImportSha      String?
  githubPullRequestUrl String?
```

Add indexes:

```prisma
  @@index([githubInstallationId])
  @@index([githubRepositoryId])
```

- [ ] **Step 6: Update seed user**

Modify `prisma/seed.ts` user upsert create/update shape:

```ts
await prisma.user.upsert({
  where: { id: devUserId },
  create: {
    id: devUserId,
    email: "dev@example.local",
    name: "Dev User",
    emailVerified: true,
  },
  update: {
    name: "Dev User",
    emailVerified: true,
  },
});
```

- [ ] **Step 7: Create migration**

Run:

```bash
pnpm db:migrate --name add_better_auth_and_github_sources
```

Expected: Prisma creates a migration and regenerates the client. If local DB is unavailable, run:

```bash
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

Use the diff output to verify SQL shape, then mark this task blocked until DB is available.

- [ ] **Step 8: Run focused schema verification**

Run:

```bash
pnpm test:host --runInBand
```

Expected: tests may fail where routes still depend on old `User` shape; schema generation should not fail. Keep route failures for the route-scoping task.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed.ts
git commit -m "feat: add auth and github prisma schema for T-20260503-006"
```

---

### Task 3: Add Current User Helper and Protect Routes

**Files:**
- Create: `lib/auth/current-user.ts`
- Create: `proxy.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/projects/[id]/models/route.ts`
- Modify: `app/api/projects/[id]/next-devtools/route.ts`
- Modify: `app/api/projects/[id]/usage/route.ts`
- Modify: `app/api/projects/[id]/sessions/route.ts`
- Modify: `app/api/projects/[id]/sessions/[sessionId]/route.ts`
- Modify: `app/api/projects/[id]/sessions/[sessionId]/messages/route.ts`
- Modify: `app/usage/page.tsx`
- Test: existing route tests under `app/api/**/__tests__`

- [ ] **Step 1: Write current user helper**

Create `lib/auth/current-user.ts`:

```ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

export async function requireCurrentUser(): Promise<
  | { ok: true; user: CurrentUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not signed in" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}

export function devFallbackUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}
```

- [ ] **Step 2: Add Next.js 16 proxy**

Create `proxy.ts`:

```ts
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/sign-in", "/api/auth"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/project/:path*", "/usage"],
};
```

Route handlers still validate sessions server-side; proxy is only redirect UX.

- [ ] **Step 3: Replace `DEV_USER_ID` in `app/api/projects/route.ts`**

Change `GET`:

```ts
export async function GET() {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;

  const projects = await prisma.project.findMany({
    where: { ownerId: current.user.id },
    orderBy: { lastActive: "desc" },
    select: projectSelect,
  });
  return NextResponse.json({
    projects: projects.map((project) => serializeProject(project)),
  });
}
```

Change project creation owner:

```ts
const current = await requireCurrentUser();
if (!current.ok) return current.response;

const project = await prisma.project.create({
  data: {
    name,
    ownerId: current.user.id,
    status: "PROVISIONING",
    agentRuntime: protocolRuntimeToDb(runtime),
    desiredRuntime: protocolRuntimeToDb(runtime),
    sessions: {
      create: {
        title: "Main chat",
        defaultRuntime: protocolRuntimeToDb(runtime),
      },
    },
  },
  select: projectSelect,
});
```

- [ ] **Step 4: Replace project ownership checks in all project routes**

Pattern for route handlers:

```ts
const current = await requireCurrentUser();
if (!current.ok) return current.response;

const project = await prisma.project.findFirst({
  where: { id, ownerId: current.user.id },
});
if (!project) {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
```

Apply this to every route listed in this task. Remove module-level `DEV_USER_ID` constants from these routes.

- [ ] **Step 5: Update `app/usage/page.tsx`**

Use `getCurrentUser()` and redirect unauthenticated users:

```ts
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function UsageDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const projects = await prisma.project.findMany({
    where: { ownerId: user.id },
    // keep existing select/order
  });
}
```

- [ ] **Step 6: Update route tests**

For unit tests that call route handlers directly, mock `requireCurrentUser()`:

```ts
vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUser: vi.fn(async () => ({
    ok: true,
    user: {
      id: "models-route-user",
      email: "models-route-user@example.com",
      name: "Models User",
      image: null,
    },
  })),
  getCurrentUser: vi.fn(),
}));
```

- [ ] **Step 7: Run route tests**

Run:

```bash
pnpm test:host app/api/projects/[id]/models/__tests__/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run host tests**

Run:

```bash
pnpm test:host
```

Expected: PASS after all route replacements in this task.

- [ ] **Step 9: Commit**

```bash
git add lib/auth/current-user.ts proxy.ts app/api app/usage/page.tsx
git commit -m "feat: scope routes by auth user for T-20260503-006"
```

---

### Task 4: Add Sign-In, Sign-Up, and Sign-Out UI

**Files:**
- Create: `app/sign-in/page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx` only if metadata needs auth copy changes

- [ ] **Step 1: Create sign-in page**

Create `app/sign-in/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Github, Loader2, LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });
      if (result.error) {
        setError(result.error.message ?? "Authentication failed");
        return;
      }
      router.push(redirectTo);
      router.refresh();
    });
  }

  function signInWithGitHub(): void {
    setError(null);
    startTransition(async () => {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: redirectTo,
      });
    });
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {mode === "sign-up" && (
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" autoComplete="name" />
            )}
            <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" autoComplete="email" />
            <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
            {error && <p className="text-sm text-red-300">{error}</p>}
            <Button type="submit" disabled={isPending || !email || !password || (mode === "sign-up" && !name)}>
              {isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
              {mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <div className="mt-3 grid gap-2">
            <Button type="button" variant="outline" onClick={signInWithGitHub} disabled={isPending}>
              <Github />
              Continue with GitHub
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
              {mode === "sign-in" ? "Create an account" : "Use existing account"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Add sign-out button to dashboard header**

In `app/page.tsx`, import `authClient` and `LogOut`. Add:

```tsx
async function signOut(): Promise<void> {
  await authClient.signOut();
  window.location.href = "/sign-in";
}
```

Add a header button:

```tsx
<Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
  <LogOut />
  Sign out
</Button>
```

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/sign-in/page.tsx app/page.tsx app/layout.tsx
git commit -m "feat: add auth screens for T-20260503-006"
```

---

### Task 5: Add GitHub App Token and Installation Services

**Files:**
- Create: `lib/github/types.ts`
- Create: `lib/github/app.ts`
- Create: `lib/github/installations.ts`
- Create: `lib/github/__tests__/app.test.ts`
- Create: `lib/github/__tests__/installations.test.ts`
- Create: `app/api/github/callback/route.ts`
- Create: `app/api/github/installations/route.ts`

- [ ] **Step 1: Define GitHub types**

Create `lib/github/types.ts`:

```ts
export type GitHubAccountType = "User" | "Organization";

export type GitHubInstallationDto = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
};

export type GitHubInstallationApiResponse = {
  id: number;
  account: {
    login: string;
    type: GitHubAccountType;
    avatar_url?: string | null;
  } | null;
  repository_selection: string;
  suspended_at?: string | null;
};
```

- [ ] **Step 2: Write JWT tests**

Create `lib/github/__tests__/app.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createGitHubAppJwt, sanitizeGitRemoteUrl } from "../app";

const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAK0aB9sL8tno5bawxAqTqD6McFhS7qH/FnDJGx9o1dDYG8hm9V7a
8vWlhH5FYnJjv5Yk0DmLq6s/9Ko3NxkCAwEAAQJBAL0TnlMJp0tSH6rDL4Hb05yL
e6fXG1n9f7u9khi7Xn9fCl8p1LDz52Jp0US2LB2xwouI5ORndkKqfa56YwECIQDa
UwwfDA9cCqGq1f1iDHLnDLGnQcbMZdr0pQpO3N30kQIhAMsQrVotMLlPlzNLNSog
cIwbo9gELfM+dMqOUMnmQt1NAiEAxUOKFFsTsLo0fEhtOXME1NmFjDvAlPwp5NDt
FADhuQECIAtpqZtjwR8k1ZxuxCNKPRc3lUEDxVpD31nPi0mAT/5BAiB1UyJuEk2d
b5KMWL64SZZ3Q5GzMI+Tr79IHVefHbZb6w==
-----END RSA PRIVATE KEY-----`;

describe("createGitHubAppJwt", () => {
  it("creates a three-part JWT without exposing the private key", () => {
    const jwt = createGitHubAppJwt({ appId: "12345", privateKey: PRIVATE_KEY, now: new Date("2026-05-03T00:00:00Z") });
    expect(jwt.split(".")).toHaveLength(3);
    expect(jwt).not.toContain("BEGIN RSA");
  });
});

describe("sanitizeGitRemoteUrl", () => {
  it("removes embedded credentials", () => {
    expect(sanitizeGitRemoteUrl("https://x-access-token:secret@github.com/acme/site.git"))
      .toBe("https://github.com/acme/site.git");
  });
});
```

- [ ] **Step 3: Implement GitHub App helpers**

Create `lib/github/app.ts`:

```ts
import { createSign } from "node:crypto";

type JwtArgs = {
  appId: string;
  privateKey: string;
  now?: Date;
};

type InstallationTokenResponse = {
  token: string;
  expires_at: string;
};

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

export function createGitHubAppJwt({ appId, privateKey, now = new Date() }: JwtArgs): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const expiresAt = issuedAt + 9 * 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

export function githubAppConfig(): { appId: string; privateKey: string; slug: string } {
  const appId = process.env.GITHUB_APP_ID ?? "";
  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const slug = process.env.GITHUB_APP_SLUG ?? "";
  if (!appId || !privateKey || !slug) {
    throw new Error("GitHub App env vars are not configured");
  }
  return { appId, privateKey, slug };
}

export async function createInstallationToken(installationId: string): Promise<string> {
  const config = githubAppConfig();
  const jwt = createGitHubAppJwt({ appId: config.appId, privateKey: config.privateKey });
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub installation token request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as InstallationTokenResponse;
  return body.token;
}

export function buildAuthenticatedGitUrl(args: { owner: string; repo: string; token: string }): string {
  return `https://x-access-token:${encodeURIComponent(args.token)}@github.com/${args.owner}/${args.repo}.git`;
}

export function sanitizeGitRemoteUrl(url: string): string {
  return url.replace(/^https:\/\/[^@]+@github\.com\//, "https://github.com/");
}
```

- [ ] **Step 4: Implement installation persistence**

Create `lib/github/installations.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { createGitHubAppJwt, githubAppConfig } from "./app";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { GitHubInstallationApiResponse, GitHubInstallationDto } from "./types";

export function signInstallationState(userId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const payload = Buffer.from(JSON.stringify({ userId, nonce: crypto.randomUUID() })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyInstallationState(state: string, userId: string): boolean {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  const [payload, sig] = state.split(".");
  if (!secret || !payload || !sig) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string };
  return parsed.userId === userId;
}

export function githubInstallUrl(userId: string): string {
  const { slug } = githubAppConfig();
  const state = signInstallationState(userId);
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

export async function fetchInstallation(installationId: string): Promise<GitHubInstallationApiResponse> {
  const config = githubAppConfig();
  const jwt = createGitHubAppJwt({ appId: config.appId, privateKey: config.privateKey });
  const response = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub installation lookup failed: HTTP ${response.status}`);
  return await response.json() as GitHubInstallationApiResponse;
}

export async function upsertInstallationForUser(user: CurrentUser, installationId: string): Promise<GitHubInstallationDto> {
  const installation = await fetchInstallation(installationId);
  if (!installation.account) throw new Error("GitHub installation has no account");
  const saved = await prisma.gitHubInstallation.upsert({
    where: {
      ownerId_installationId: {
        ownerId: user.id,
        installationId: BigInt(installation.id),
      },
    },
    create: {
      ownerId: user.id,
      installationId: BigInt(installation.id),
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
  return {
    id: saved.id,
    installationId: saved.installationId.toString(),
    accountLogin: saved.accountLogin,
    accountType: saved.accountType,
    accountAvatarUrl: saved.accountAvatarUrl,
    repositorySelection: saved.repositorySelection,
  };
}
```

- [ ] **Step 5: Add installation APIs**

Create `app/api/github/installations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { githubInstallUrl } from "@/lib/github/installations";

export async function GET(): Promise<NextResponse> {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;
  const installations = await prisma.gitHubInstallation.findMany({
    where: { ownerId: current.user.id },
    orderBy: { accountLogin: "asc" },
  });
  return NextResponse.json({
    installUrl: githubInstallUrl(current.user.id),
    installations: installations.map((installation) => ({
      id: installation.id,
      installationId: installation.installationId.toString(),
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      accountAvatarUrl: installation.accountAvatarUrl,
      repositorySelection: installation.repositorySelection,
    })),
  });
}
```

Create `app/api/github/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { upsertInstallationForUser, verifyInstallationState } from "@/lib/github/installations";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;
  const installationId = request.nextUrl.searchParams.get("installation_id");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (!installationId || !verifyInstallationState(state, current.user.id)) {
    return NextResponse.json({ error: "invalid github callback" }, { status: 400 });
  }
  await upsertInstallationForUser(current.user, installationId);
  return NextResponse.redirect(new URL("/", request.url));
}
```

- [ ] **Step 6: Run tests and lint**

Run:

```bash
pnpm test:host lib/github/__tests__/app.test.ts
pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/github app/api/github
git commit -m "feat: add github app installation services for T-20260503-006"
```

---

### Task 6: Add Repository and Branch Listing

**Files:**
- Create: `lib/github/repositories.ts`
- Create: `lib/github/__tests__/repositories.test.ts`
- Create: `app/api/github/installations/[installationId]/repositories/route.ts`
- Create: `app/api/github/repositories/[repositoryId]/branches/route.ts`

- [ ] **Step 1: Write repository normalization test**

Create `lib/github/__tests__/repositories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeRepository, normalizeBranch } from "../repositories";

describe("normalizeRepository", () => {
  it("maps GitHub repository API fields", () => {
    expect(normalizeRepository({
      id: 42,
      name: "site",
      full_name: "acme/site",
      private: true,
      default_branch: "main",
      owner: { login: "acme" },
    })).toEqual({
      githubRepoId: "42",
      ownerLogin: "acme",
      name: "site",
      fullName: "acme/site",
      private: true,
      defaultBranch: "main",
    });
  });
});

describe("normalizeBranch", () => {
  it("maps branch names and sha", () => {
    expect(normalizeBranch({ name: "main", commit: { sha: "abc123" } })).toEqual({
      name: "main",
      sha: "abc123",
    });
  });
});
```

- [ ] **Step 2: Implement repository service**

Create `lib/github/repositories.ts`:

```ts
import { prisma } from "@/lib/db/client";
import { createInstallationToken } from "./app";

type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
};

type RawBranch = {
  name: string;
  commit: { sha: string };
};

export type RepositoryDto = {
  id?: string;
  githubRepoId: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type BranchDto = {
  name: string;
  sha: string;
};

export function normalizeRepository(repo: RawRepo): RepositoryDto {
  return {
    githubRepoId: repo.id.toString(),
    ownerLogin: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
  };
}

export function normalizeBranch(branch: RawBranch): BranchDto {
  return {
    name: branch.name,
    sha: branch.commit.sha,
  };
}

export async function listInstallationRepositories(args: { userId: string; installationRecordId: string }): Promise<RepositoryDto[]> {
  const installation = await prisma.gitHubInstallation.findFirst({
    where: { id: args.installationRecordId, ownerId: args.userId },
  });
  if (!installation) throw new Error("GitHub installation not found");
  const token = await createInstallationToken(installation.installationId.toString());
  const response = await fetch(`https://api.github.com/installation/repositories?per_page=100`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub repositories request failed: HTTP ${response.status}`);
  const body = await response.json() as { repositories: RawRepo[] };
  const repos = body.repositories.map(normalizeRepository);
  for (const repo of repos) {
    const saved = await prisma.gitHubRepository.upsert({
      where: {
        installationId_githubRepoId: {
          installationId: installation.id,
          githubRepoId: BigInt(repo.githubRepoId),
        },
      },
      create: {
        installationId: installation.id,
        githubRepoId: BigInt(repo.githubRepoId),
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        lastSyncedAt: new Date(),
      },
      update: {
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        lastSyncedAt: new Date(),
      },
    });
    repo.id = saved.id;
  }
  return repos;
}

export async function listRepositoryBranches(args: { userId: string; repositoryId: string }): Promise<BranchDto[]> {
  const repo = await prisma.gitHubRepository.findFirst({
    where: {
      id: args.repositoryId,
      installation: { ownerId: args.userId },
    },
    include: { installation: true },
  });
  if (!repo) throw new Error("GitHub repository not found");
  const token = await createInstallationToken(repo.installation.installationId.toString());
  const response = await fetch(`https://api.github.com/repos/${repo.ownerLogin}/${repo.name}/branches?per_page=100`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub branches request failed: HTTP ${response.status}`);
  const branches = await response.json() as RawBranch[];
  return branches.map(normalizeBranch);
}
```

- [ ] **Step 3: Add repository listing route**

Create `app/api/github/installations/[installationId]/repositories/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { listInstallationRepositories } from "@/lib/github/repositories";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ installationId: string }> },
): Promise<NextResponse> {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;
  const { installationId } = await params;
  try {
    const repositories = await listInstallationRepositories({
      userId: current.user.id,
      installationRecordId: installationId,
    });
    return NextResponse.json({ repositories });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "failed" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Add branch listing route**

Create `app/api/github/repositories/[repositoryId]/branches/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { listRepositoryBranches } from "@/lib/github/repositories";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
): Promise<NextResponse> {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;
  const { repositoryId } = await params;
  try {
    const branches = await listRepositoryBranches({ userId: current.user.id, repositoryId });
    return NextResponse.json({ branches });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "failed" }, { status: 400 });
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test:host lib/github/__tests__/repositories.test.ts
pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/github/repositories.ts lib/github/__tests__/repositories.test.ts app/api/github/installations app/api/github/repositories
git commit -m "feat: list github app repositories for T-20260503-006"
```

---

### Task 7: Extend Project Source and Runtime Spawn Contract

**Files:**
- Modify: `lib/runtime/types.ts`
- Modify: `lib/runtime/daytona/cloud.ts`
- Modify: `lib/runtime/daytona/fake.ts`
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Create: `lib/projects/source.ts`
- Create: `lib/projects/__tests__/source.test.ts`
- Modify: `app/api/projects/route.ts`

- [ ] **Step 1: Write source mapping test**

Create `lib/projects/__tests__/source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectSourceFromCreateBody } from "../source";

describe("projectSourceFromCreateBody", () => {
  it("defaults to template", () => {
    expect(projectSourceFromCreateBody({})).toEqual({ type: "template" });
  });

  it("parses github source", () => {
    expect(projectSourceFromCreateBody({
      sourceType: "github",
      repositoryId: "repo-1",
      branch: "main",
    })).toEqual({
      type: "github",
      repositoryId: "repo-1",
      branch: "main",
    });
  });
});
```

- [ ] **Step 2: Implement source parser**

Create `lib/projects/source.ts`:

```ts
export type ProjectCreateSource =
  | { type: "template" }
  | { type: "github"; repositoryId: string; branch: string };

export function projectSourceFromCreateBody(body: Record<string, unknown>): ProjectCreateSource {
  if (body.sourceType !== "github") return { type: "template" };
  const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!repositoryId || !branch) {
    throw new Error("repositoryId and branch are required");
  }
  return { type: "github", repositoryId, branch };
}
```

- [ ] **Step 3: Modify runtime types**

Change `lib/runtime/types.ts`:

```ts
export type ProjectSource =
  | { type: "template" }
  | {
      type: "github";
      installationId: string;
      owner: string;
      repo: string;
      branch: string;
      commitSha?: string;
      token: string;
    };

export interface SpawnArgs {
  projectId: string;
  source: ProjectSource;
}
```

Remove `cloneToken`, `repoOwner`, and `repoName` from `SpawnArgs`.

- [ ] **Step 4: Update worker-pool env mapping**

In `lib/runtime/worker-pool/runtime.ts`, build source env:

```ts
function sourceEnv(source: SpawnArgs["source"]): Record<string, string> {
  if (source.type === "template") {
    return { PROJECT_SOURCE_TYPE: "template" };
  }
  return {
    PROJECT_SOURCE_TYPE: "github",
    GITHUB_REPO_OWNER: source.owner,
    GITHUB_REPO_NAME: source.repo,
    GITHUB_REPO_BRANCH: source.branch,
    GITHUB_REPO_TOKEN: source.token,
    GITHUB_REPO_COMMIT_SHA: source.commitSha ?? "",
  };
}
```

Use it:

```ts
const env: Record<string, string> = {
  PROJECT_ID: spawn.projectId,
  BROKER_TOKEN: brokerToken,
  ...sourceEnv(spawn.source),
  ...args.brokerEnv?.(),
};
```

- [ ] **Step 5: Update Daytona cloud spawn**

In `lib/runtime/daytona/cloud.ts`, change `spawnProjectSandbox` to require `source`.

For template:

```ts
if (source.type !== "github") {
  throw new Error("Daytona Cloud runtime requires a GitHub project source");
}
```

Use `source.token`, `source.owner`, `source.repo`, and `source.branch` in `buildBootCommand`.

- [ ] **Step 6: Update project create route**

In `app/api/projects/route.ts`, parse source:

```ts
const source = projectSourceFromCreateBody(body as Record<string, unknown>);
```

For GitHub source, load repo scoped by user and create installation token:

```ts
const repo = source.type === "github"
  ? await prisma.gitHubRepository.findFirst({
      where: { id: source.repositoryId, installation: { ownerId: current.user.id } },
      include: { installation: true },
    })
  : null;
if (source.type === "github" && !repo) {
  return NextResponse.json({ error: "repository not found" }, { status: 404 });
}
```

Set project fields:

```ts
sourceType: source.type === "github" ? "GITHUB" : "TEMPLATE",
githubInstallationId: repo?.installationId ?? null,
githubRepositoryId: repo?.id ?? null,
githubOwner: repo?.ownerLogin ?? null,
githubRepo: repo?.name ?? null,
githubBaseBranch: source.type === "github" ? source.branch : null,
```

Spawn:

```ts
const spawnSource = source.type === "github" && repo
  ? {
      type: "github" as const,
      installationId: repo.installation.installationId.toString(),
      owner: repo.ownerLogin,
      repo: repo.name,
      branch: source.branch,
      token: await createInstallationToken(repo.installation.installationId.toString()),
    }
  : { type: "template" as const };
```

Pass:

```ts
sandboxRuntime.spawnProjectSandbox({
  projectId: project.id,
  source: spawnSource,
})
```

- [ ] **Step 7: Update tests**

Update runtime tests to pass `{ source: { type: "template" } }` for existing spawn calls.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm test:host lib/projects/__tests__/source.test.ts
pnpm test:host lib/runtime
pnpm lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/runtime lib/projects app/api/projects/route.ts
git commit -m "feat: add project source runtime contract for T-20260503-006"
```

---

### Task 8: Clone GitHub Repos in Sandbox Entrypoint

**Files:**
- Modify: `container/sandbox/entrypoint.sh`
- Test: shell-level manual test with local temporary repo

- [ ] **Step 1: Add clone helpers to entrypoint**

In `container/sandbox/entrypoint.sh`, after env defaults:

```sh
PROJECT_SOURCE_TYPE="${PROJECT_SOURCE_TYPE:-template}"
GITHUB_REPO_OWNER="${GITHUB_REPO_OWNER:-}"
GITHUB_REPO_NAME="${GITHUB_REPO_NAME:-}"
GITHUB_REPO_BRANCH="${GITHUB_REPO_BRANCH:-}"
GITHUB_REPO_TOKEN="${GITHUB_REPO_TOKEN:-}"
GITHUB_REPO_COMMIT_SHA="${GITHUB_REPO_COMMIT_SHA:-}"

sanitize_url() {
  echo "$1" | sed -E 's#https://[^@]+@github.com/#https://github.com/#'
}

clone_github_repo() {
  if [ -z "$GITHUB_REPO_OWNER" ] || [ -z "$GITHUB_REPO_NAME" ] || [ -z "$GITHUB_REPO_BRANCH" ] || [ -z "$GITHUB_REPO_TOKEN" ]; then
    echo "[entrypoint] FATAL: missing GitHub source env" >&2
    exit 1
  fi
  mkdir -p /workspace
  rm -rf /workspace/project
  CLONE_URL="https://x-access-token:${GITHUB_REPO_TOKEN}@github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}.git"
  echo "[entrypoint] cloning $(sanitize_url "$CLONE_URL") branch ${GITHUB_REPO_BRANCH}"
  git clone --depth 1 --branch "$GITHUB_REPO_BRANCH" "$CLONE_URL" /workspace/project 2>/workspace/git-clone.err || {
    echo "[entrypoint] FATAL: git clone failed for ${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}" >&2
    sed -E 's#https://[^@]+@github.com/#https://github.com/#g' /workspace/git-clone.err >&2
    exit 1
  }
  if [ -n "$GITHUB_REPO_COMMIT_SHA" ]; then
    cd /workspace/project
    git fetch --depth 1 origin "$GITHUB_REPO_COMMIT_SHA" || true
    git checkout "$GITHUB_REPO_COMMIT_SHA"
  fi
}
```

- [ ] **Step 2: Switch seeding logic**

Replace current template seeding block with:

```sh
mkdir -p /workspace
if [ "$PROJECT_SOURCE_TYPE" = "github" ]; then
  if [ ! -d /workspace/project/.git ]; then
    clone_github_repo
  fi
else
  if [ ! -d /workspace/project ] || [ -z "$(ls -A /workspace/project 2>/dev/null)" ]; then
    echo "[entrypoint] seeding /workspace/project from /opt/project-template"
    mkdir -p /workspace/project
    cp -a /opt/project-template/. /workspace/project/
  fi
fi
```

- [ ] **Step 3: Detect package manager**

Replace `pnpm dev` start with:

```sh
if [ -f pnpm-lock.yaml ]; then
  corepack enable pnpm
  pnpm install --frozen-lockfile || pnpm install
  DEV_CMD="pnpm dev"
elif [ -f package-lock.json ]; then
  npm install
  DEV_CMD="npm run dev"
elif [ -f yarn.lock ]; then
  corepack enable yarn
  yarn install
  DEV_CMD="yarn dev"
else
  corepack enable pnpm
  pnpm install
  DEV_CMD="pnpm dev"
fi

PORT="${PREVIEW_PORT}" PROJECT_ID="${PROJECT_ID}" \
  sh -c "$DEV_CMD" > /workspace/project.log 2>&1 &
```

- [ ] **Step 4: Preserve git identity**

Keep git identity setup but avoid creating an initial template commit for GitHub projects:

```sh
git config user.email "sandbox@wbd.local"
git config user.name "Website Builder Daytona"

if [ "$PROJECT_SOURCE_TYPE" != "github" ] && [ ! -d .git ]; then
  echo "[entrypoint] initialising git repo in /workspace/project"
  git init -q -b main
  git add -A
  git commit -q -m "initial template" || true
fi
```

- [ ] **Step 5: Run shell syntax check**

Run:

```bash
sh -n container/sandbox/entrypoint.sh
```

Expected: no output and exit code 0.

- [ ] **Step 6: Run focused runtime tests**

Run:

```bash
pnpm test:host lib/runtime/worker-pool
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add container/sandbox/entrypoint.sh
git commit -m "feat: clone github repos in sandbox for T-20260503-006"
```

---

### Task 9: Add Dashboard GitHub Import Flow

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add UI types**

In `app/page.tsx`, add:

```ts
type GitHubInstallation = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
};

type GitHubRepository = {
  id: string;
  githubRepoId: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

type GitHubBranch = {
  name: string;
  sha: string;
};
```

Extend `Project` type:

```ts
sourceType: "TEMPLATE" | "GITHUB";
githubOwner: string | null;
githubRepo: string | null;
githubBaseBranch: string | null;
githubPullRequestUrl: string | null;
```

- [ ] **Step 2: Add dashboard state**

Add state:

```ts
const [installUrl, setInstallUrl] = useState<string | null>(null);
const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
const [selectedInstallationId, setSelectedInstallationId] = useState("");
const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
const [branches, setBranches] = useState<GitHubBranch[]>([]);
const [selectedBranch, setSelectedBranch] = useState("");
```

- [ ] **Step 3: Load installations**

Add:

```ts
async function refreshGitHubInstallations(): Promise<void> {
  const res = await fetch("/api/github/installations", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json() as { installUrl: string; installations: GitHubInstallation[] };
  setInstallUrl(data.installUrl);
  setInstallations(data.installations);
  if (!selectedInstallationId && data.installations[0]) {
    setSelectedInstallationId(data.installations[0].id);
  }
}
```

Call it in the initial load `useEffect`.

- [ ] **Step 4: Load repositories and branches**

Add:

```ts
async function loadRepositories(installationId: string): Promise<void> {
  const res = await fetch(`/api/github/installations/${installationId}/repositories`, { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json() as { repositories: GitHubRepository[] };
  setRepositories(data.repositories);
}

async function loadBranches(repositoryId: string): Promise<void> {
  const res = await fetch(`/api/github/repositories/${repositoryId}/branches`, { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json() as { branches: GitHubBranch[] };
  setBranches(data.branches);
  setSelectedBranch(data.branches[0]?.name ?? "");
}
```

Add effects that call these when selected IDs change.

- [ ] **Step 5: Change create request**

Modify `create()` body:

```ts
const selectedRepo = repositories.find((repo) => repo.id === selectedRepositoryId);
const payload = selectedRepo
  ? {
      name: name.trim() || selectedRepo.name,
      sourceType: "github",
      repositoryId: selectedRepo.id,
      branch: selectedBranch || selectedRepo.defaultBranch,
    }
  : { name };
```

Use `JSON.stringify(payload)`.

- [ ] **Step 6: Render GitHub connection and import controls**

Inside the "New project" card, add controls before the submit button:

```tsx
{installUrl && (
  <Button asChild type="button" variant="outline">
    <a href={installUrl}>Install GitHub App</a>
  </Button>
)}
{installations.length > 0 && (
  <select value={selectedInstallationId} onChange={(event) => setSelectedInstallationId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
    {installations.map((installation) => (
      <option key={installation.id} value={installation.id}>
        {installation.accountLogin} ({installation.accountType})
      </option>
    ))}
  </select>
)}
{repositories.length > 0 && (
  <select value={selectedRepositoryId} onChange={(event) => setSelectedRepositoryId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
    <option value="">Template project</option>
    {repositories.map((repo) => (
      <option key={repo.id} value={repo.id}>
        {repo.fullName}{repo.private ? " private" : ""}
      </option>
    ))}
  </select>
)}
{branches.length > 0 && selectedRepositoryId && (
  <select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
    {branches.map((branch) => (
      <option key={branch.name} value={branch.name}>{branch.name}</option>
    ))}
  </select>
)}
```

- [ ] **Step 7: Show source metadata in project list**

In project rows/cards, add:

```tsx
{project.sourceType === "GITHUB" && project.githubOwner && project.githubRepo && (
  <span>{project.githubOwner}/{project.githubRepo} · {project.githubBaseBranch}</span>
)}
```

- [ ] **Step 8: Run lint/build**

Run:

```bash
pnpm lint
pnpm build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add github repo import UI for T-20260503-006"
```

---

### Task 10: Add Pull Request Service and Workspace Action

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Create: `container/sandbox/broker/src/git-handlers.ts`
- Create: `container/sandbox/broker/tests/git-handlers.test.ts`
- Modify: `container/sandbox/broker/src/ws-server.ts`
- Create: `lib/projects/broker-git.ts`
- Create: `lib/github/pull-requests.ts`
- Create: `lib/github/__tests__/pull-requests.test.ts`
- Create: `app/api/projects/[id]/pull-request/route.ts`
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Write branch name test**

Create `lib/github/__tests__/pull-requests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { workingBranchForProject } from "../pull-requests";

describe("workingBranchForProject", () => {
  it("creates deterministic safe branch names", () => {
    expect(workingBranchForProject({ projectId: "clx123", name: "Marketing Site!" }))
      .toBe("wbd/clx123-marketing-site");
  });
});
```

- [ ] **Step 2: Implement PR service**

Create `lib/github/pull-requests.ts`:

```ts
import { prisma } from "@/lib/db/client";
import { createInstallationToken } from "./app";
import { pushProjectChanges } from "@/lib/projects/broker-git";

export function workingBranchForProject(args: { projectId: string; name: string }): string {
  const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `wbd/${args.projectId}-${slug || "changes"}`;
}

type GitHubRef = {
  object: { sha: string };
};

export async function createProjectPullRequest(args: { userId: string; projectId: string; title?: string }): Promise<{ url: string; branch: string }> {
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, ownerId: args.userId, sourceType: "GITHUB" },
    include: { githubInstallation: true },
  });
  if (!project?.githubInstallation || !project.githubOwner || !project.githubRepo || !project.githubBaseBranch) {
    throw new Error("project is not connected to GitHub");
  }
  const token = await createInstallationToken(project.githubInstallation.installationId.toString());
  const branch = project.githubWorkingBranch ?? workingBranchForProject({ projectId: project.id, name: project.name });
  const commitMessage = args.title ?? `Website Builder changes for ${project.name}`;
  await pushProjectChanges({
    brokerUrl: project.brokerUrl,
    branch,
    token,
    owner: project.githubOwner,
    repo: project.githubRepo,
    commitMessage,
  });
  const baseRef = await githubJson<GitHubRef>({
    token,
    path: `/repos/${project.githubOwner}/${project.githubRepo}/git/ref/heads/${project.githubBaseBranch}`,
  });
  await githubJson({
    token,
    path: `/repos/${project.githubOwner}/${project.githubRepo}/git/refs`,
    method: "POST",
    body: {
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha,
    },
    allowConflict: true,
  });
  const pr = await githubJson<{ html_url: string }>({
    token,
    path: `/repos/${project.githubOwner}/${project.githubRepo}/pulls`,
    method: "POST",
    body: {
      title: args.title ?? `Website Builder changes for ${project.name}`,
      head: branch,
      base: project.githubBaseBranch,
      body: "Changes prepared from Website Builder Daytona.",
    },
    allowConflict: true,
  });
  await prisma.project.update({
    where: { id: project.id },
    data: {
      githubWorkingBranch: branch,
      githubPullRequestUrl: pr.html_url,
    },
  });
  return { url: pr.html_url, branch };
}

async function githubJson<T>(args: {
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  allowConflict?: boolean;
}): Promise<T> {
  const response = await fetch(`https://api.github.com${args.path}`, {
    method: args.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
  if (args.allowConflict && response.status === 422) {
    return {} as T;
  }
  if (!response.ok) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  return await response.json() as T;
}
```

- [ ] **Step 3: Add protocol messages**

Modify `packages/protocol/src/index.ts`.

Add to `HostToBroker`:

```ts
  | {
      type: "git.commit_push";
      requestId: string;
      remoteUrl: string;
      branch: string;
      commitMessage: string;
    }
```

Add to `BrokerToHost`:

```ts
  | {
      type: "git.commit_push.result";
      requestId: string;
      ok: boolean;
      branch: string;
      commitSha?: string;
      error?: "no_changes" | "git_error";
      message?: string;
    }
```

- [ ] **Step 4: Add broker git handler tests**

Create `container/sandbox/broker/tests/git-handlers.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { commitAndPushChanges, sanitizeGitOutput } from "../src/git-handlers";

const exec = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<void> {
  await exec("git", args, { cwd });
}

async function repoFixture(): Promise<{ project: string; remote: string }> {
  const root = await mkdtemp(join(tmpdir(), "wbd-git-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const project = join(root, "project");
  await exec("git", ["init", "--bare", remote]);
  await exec("git", ["clone", remote, project]);
  await git(project, ["config", "user.email", "test@example.local"]);
  await git(project, ["config", "user.name", "Test User"]);
  await writeFile(join(project, "README.md"), "initial\n");
  await git(project, ["add", "README.md"]);
  await git(project, ["commit", "-m", "initial"]);
  await git(project, ["push", "origin", "HEAD:main"]);
  return { project, remote };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sanitizeGitOutput", () => {
  it("removes token credentials", () => {
    expect(sanitizeGitOutput("https://x-access-token:secret@github.com/acme/site.git"))
      .toBe("https://github.com/acme/site.git");
  });
});

describe("commitAndPushChanges", () => {
  it("returns no_changes for a clean repo", async () => {
    const { project, remote } = await repoFixture();
    const result = await commitAndPushChanges({
      projectRoot: project,
      remoteUrl: remote,
      branch: "wbd/test",
      commitMessage: "test",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_changes");
  });

  it("commits and pushes changes", async () => {
    const { project, remote } = await repoFixture();
    await writeFile(join(project, "README.md"), "changed\n");
    const result = await commitAndPushChanges({
      projectRoot: project,
      remoteUrl: remote,
      branch: "wbd/test",
      commitMessage: "change readme",
    });
    expect(result.ok).toBe(true);
    expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);
  });
});
```

- [ ] **Step 5: Implement broker git handler**

Create `container/sandbox/broker/src/git-handlers.ts`:

```ts
import { spawn } from "node:child_process";

export type CommitPushArgs = {
  projectRoot: string;
  remoteUrl: string;
  branch: string;
  commitMessage: string;
};

export type CommitPushResult =
  | { ok: true; branch: string; commitSha: string }
  | { ok: false; branch: string; error: "no_changes" | "git_error"; message: string };

export function sanitizeGitOutput(value: string): string {
  return value.replace(/https:\/\/[^@\s]+@github\.com\//g, "https://github.com/");
}

export async function commitAndPushChanges(args: CommitPushArgs): Promise<CommitPushResult> {
  const status = await git(args.projectRoot, ["status", "--porcelain"]);
  if (!status.stdout.trim()) {
    return { ok: false, branch: args.branch, error: "no_changes", message: "no changes to commit" };
  }
  const steps: string[][] = [
    ["config", "user.email", "sandbox@wbd.local"],
    ["config", "user.name", "Website Builder Daytona"],
    ["remote", "set-url", "origin", args.remoteUrl],
    ["checkout", "-B", args.branch],
    ["add", "-A"],
    ["commit", "-m", args.commitMessage],
    ["push", "-u", "origin", args.branch],
  ];
  for (const step of steps) {
    const result = await git(args.projectRoot, step);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        branch: args.branch,
        error: "git_error",
        message: sanitizeGitOutput(result.stderr || result.stdout || `git ${step[0]} failed`),
      };
    }
  }
  const sha = await git(args.projectRoot, ["rev-parse", "HEAD"]);
  if (sha.exitCode !== 0) {
    return { ok: false, branch: args.branch, error: "git_error", message: sanitizeGitOutput(sha.stderr) };
  }
  return { ok: true, branch: args.branch, commitSha: sha.stdout.trim() };
}

async function git(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: error.message }));
  });
}
```

- [ ] **Step 6: Wire broker WebSocket handling**

In `container/sandbox/broker/src/ws-server.ts`, import:

```ts
import { commitAndPushChanges } from "./git-handlers";
```

Inside the message handler, add before file handlers:

```ts
if (msg.type === "git.commit_push") {
  const result = await commitAndPushChanges({
    projectRoot,
    remoteUrl: msg.remoteUrl,
    branch: msg.branch,
    commitMessage: msg.commitMessage,
  });
  socket.send(JSON.stringify({
    type: "git.commit_push.result",
    requestId: msg.requestId,
    ...result,
  }));
  return;
}
```

Use the existing project root variable in `ws-server.ts`; if it has a different name, use the same value currently passed to file handlers.

- [ ] **Step 7: Create server-to-broker push helper**

Create `lib/projects/broker-git.ts`:

```ts
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

import { buildAuthenticatedGitUrl } from "@/lib/github/app";
import type { BrokerToHost, HostToBroker } from "@wbd/protocol";

type PushArgs = {
  brokerUrl: string | null;
  owner: string;
  repo: string;
  token: string;
  branch: string;
  commitMessage: string;
};

export async function pushProjectChanges(args: PushArgs): Promise<{ commitSha: string }> {
  if (!args.brokerUrl) throw new Error("project broker is not running");
  const requestId = randomUUID();
  const remoteUrl = buildAuthenticatedGitUrl({ owner: args.owner, repo: args.repo, token: args.token });
  const message: HostToBroker = {
    type: "git.commit_push",
    requestId,
    remoteUrl,
    branch: args.branch,
    commitMessage: args.commitMessage,
  };
  const result = await sendBrokerRequest(args.brokerUrl, message, requestId);
  if (!result.ok) {
    throw new Error(result.message ?? result.error ?? "git push failed");
  }
  if (!result.commitSha) throw new Error("git push did not return commit sha");
  return { commitSha: result.commitSha };
}

function sendBrokerRequest(
  brokerUrl: string,
  message: HostToBroker,
  requestId: string,
): Promise<Extract<BrokerToHost, { type: "git.commit_push.result" }>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(brokerUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("git push timed out"));
    }, 60_000);
    ws.on("open", () => ws.send(JSON.stringify(message)));
    ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString()) as BrokerToHost;
      if (parsed.type === "git.commit_push.result" && parsed.requestId === requestId) {
        clearTimeout(timeout);
        ws.close();
        resolve(parsed);
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
```

- [ ] **Step 8: Add pull-request API route**

Create `app/api/projects/[id]/pull-request/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { createProjectPullRequest } from "@/lib/github/pull-requests";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const current = await requireCurrentUser();
  if (!current.ok) return current.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { title?: unknown };
  try {
    const result = await createProjectPullRequest({
      userId: current.user.id,
      projectId: id,
      title: typeof body.title === "string" ? body.title : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "failed" }, { status: 400 });
  }
}
```

- [ ] **Step 9: Add workspace action**

In `app/project/[id]/page.tsx`, extend `Project` type with GitHub fields and add state:

```ts
const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
const [isCreatingPr, setIsCreatingPr] = useState(false);
```

Add function:

```ts
async function createPullRequest(): Promise<void> {
  setIsCreatingPr(true);
  try {
    const res = await fetch(`/api/projects/${id}/pull-request`, { method: "POST" });
    const data = await res.json() as { url?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "failed to create pull request");
    setPullRequestUrl(data.url ?? null);
  } catch (error) {
    setError(error instanceof Error ? error.message : "failed to create pull request");
  } finally {
    setIsCreatingPr(false);
  }
}
```

Render compact action near workspace status:

```tsx
{project?.sourceType === "GITHUB" && (
  <Button type="button" onClick={() => void createPullRequest()} disabled={isCreatingPr} variant="outline" size="sm">
    {isCreatingPr ? <Loader2 className="animate-spin" /> : <GitPullRequest />}
    Create PR
  </Button>
)}
{(pullRequestUrl || project?.githubPullRequestUrl) && (
  <Button asChild variant="secondary" size="sm">
    <a href={pullRequestUrl ?? project?.githubPullRequestUrl ?? "#"} target="_blank" rel="noreferrer">Open PR</a>
  </Button>
)}
```

- [ ] **Step 10: Run tests and build**

Run:

```bash
pnpm -F @wbd/broker test -- git-handlers.test.ts
pnpm test:host lib/github/__tests__/pull-requests.test.ts
pnpm lint
pnpm build
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/protocol/src/index.ts container/sandbox/broker/src/git-handlers.ts container/sandbox/broker/tests/git-handlers.test.ts container/sandbox/broker/src/ws-server.ts lib/projects/broker-git.ts lib/github/pull-requests.ts lib/github/__tests__/pull-requests.test.ts app/api/projects/[id]/pull-request app/project/[id]/page.tsx
git commit -m "feat: create github pull requests for T-20260503-006"
```

---

### Task 11: Full Verification and Documentation

**Files:**
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md` if runtime env/source behavior changed.
- Modify: `CHANGELOG.md`
- Modify: `TASKS.md`
- Modify: `.env.example` if any env var changed during implementation.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm lint
pnpm test:host
pnpm build
```

Expected: PASS.

If worker-agent or runtime package code changed beyond env forwarding, run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Manual local smoke test**

With a local database and valid auth env:

```bash
pnpm db:migrate
pnpm dev
```

Expected:

- `/sign-in` loads.
- Email/password account can be created.
- Dashboard redirects when signed out.
- Dashboard loads when signed in.
- GitHub install URL renders when env vars exist.
- Template project creation still works.

- [ ] **Step 3: Manual GitHub smoke test**

With a test GitHub App installed on a test private repo:

1. Sign in.
2. Install GitHub App on a personal account or organization.
3. Select private repo and branch.
4. Create project.
5. Confirm sandbox preview starts.
6. Make a small file change through the agent/editor.
7. Create PR.
8. Confirm PR appears on GitHub and token values are absent from logs.

- [ ] **Step 4: Update docs**

Add a concise section to `docs/AGENT_RUNTIME_OPTIONS.md` or a new doc if clearer:

```md
## GitHub-backed Projects

GitHub-backed projects use Better Auth for user sessions and GitHub App
installation tokens for repository access. Configure:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_APP_ID`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_SLUG`
- `GITHUB_WEBHOOK_SECRET`

The sandbox receives short-lived source metadata at spawn time. Do not configure
global clone tokens for user repositories.
```

- [ ] **Step 5: Mark task complete**

Update `TASKS.md` row `T-20260503-006` to `Done` only after verification passes. Add `CHANGELOG.md` entry under `2026-05-03`.

- [ ] **Step 6: Final commit**

```bash
git add docs/AGENT_RUNTIME_OPTIONS.md .env.example TASKS.md CHANGELOG.md
git commit -m "docs: document github auth integration for T-20260503-006"
```

---

## Self-Review

Spec coverage:

- Better Auth email/password and GitHub login: Tasks 1-4.
- Current-user route scoping replacing `DEV_USER_ID`: Task 3.
- GitHub App personal and organization installations: Task 5.
- Private repository and branch listing: Task 6.
- Project source metadata and runtime spawn source contract: Task 7.
- Sandbox boot from GitHub branch: Task 8.
- Dashboard import UI: Task 9.
- Branch/PR save-back: Task 10.
- Verification and docs: Task 11.

Known implementation risk to resolve during execution:

- Better Auth's generated Prisma model names may differ from the proposed `AuthSession` rename. The implementing worker must generate schema first and configure Better Auth model mapping when preserving the existing chat `Session` model.
- Task 10 adds the broker-side git commit/push boundary before PR creation. The implementation must keep the GitHub token server-side and sanitize all git output before returning errors.
