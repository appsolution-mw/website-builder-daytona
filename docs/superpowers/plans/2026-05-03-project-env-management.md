# Project Env Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable project-level dotenv management and sync the saved content to `/workspace/project/.env` in current and newly spawned sandboxes.

**Architecture:** Store one raw dotenv document per project in Prisma, expose it through a project-scoped route, and let the workspace save to the DB before syncing `.env` through the existing broker file-write protocol. Runtime spawn receives optional env content and writes it into new fake, worker-pool, and Daytona sandboxes without logging secrets.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Vitest, Docker worker-agent, Daytona SDK, existing `@wbd/protocol` file messages.

---

## Execution Notes

- Task ID: `T-20260503-007`.
- Use small focused commits.
- Do not log dotenv content.
- Do not install dependencies.
- Before editing Next.js route code, inspect local Next.js docs under `node_modules/next/dist/docs/`.
- Use test-first implementation for behavior changes.
- Delegation strategy: inline execution is acceptable because the change crosses shared contracts and the current session has the relevant context. If subagents are explicitly chosen, split by API/data, runtime, and UI with disjoint write scopes.

## File Structure

- Create `prisma/migrations/20260503120000_add_project_environment/migration.sql`: DB table for durable env content.
- Modify `prisma/schema.prisma`: add `Project.environment` relation and `ProjectEnvironment` model.
- Create `app/api/projects/[id]/environment/route.ts`: GET/PUT project env API.
- Create `app/api/projects/[id]/environment/__tests__/route.test.ts`: API ownership, empty, upsert, and validation tests.
- Modify `lib/runtime/types.ts`: add `projectEnvContent?: string` to `SpawnArgs`.
- Modify `lib/runtime/worker-pool/runtime.ts`: pass encoded env content to sandbox env.
- Modify `lib/runtime/worker-pool/__tests__/runtime.test.ts`: verify encoded env reaches worker-agent request.
- Modify `lib/runtime/daytona/fake.ts`: write `.env` to fake project root.
- Modify `lib/runtime/daytona/__tests__/fake.test.ts`: verify fake `.env` write via broker file read.
- Modify `lib/runtime/daytona/cloud.ts`: write encoded env content during Daytona boot.
- Modify `container/sandbox/entrypoint.sh`: decode `PROJECT_ENV_B64` into `/workspace/project/.env`.
- Create `container/sandbox/__tests__/entrypoint-env.test.ts` only if shell behavior is not covered by an existing package script; otherwise verify with `sh -n` and a focused shell invocation.
- Modify `app/api/projects/route.ts` and `app/api/projects/[id]/route.ts`: pass saved env content on spawn and fake respawn.
- Modify `app/project/[id]/page.tsx`: add Env UI, API save, and broker sync.

## Task 1: Data Model And API

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260503120000_add_project_environment/migration.sql`
- Create: `app/api/projects/[id]/environment/route.ts`
- Create: `app/api/projects/[id]/environment/__tests__/route.test.ts`

- [ ] **Step 1: Read Next.js Route Handler docs**

Run:

```bash
rg -n "Route Handlers|route.ts|export async function" node_modules/next/dist/docs -g '*.md' | head -20
```

Then open the most relevant local docs file with `sed -n`.

- [ ] **Step 2: Write failing API tests**

Create `app/api/projects/[id]/environment/__tests__/route.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../../../../lib/db/client";
import { GET, PUT } from "../route";

const DEV_USER_ID = "environment-route-user";
const OTHER_USER_ID = "environment-route-other";
const PROJECT_ID = "environment-route-project";
const OTHER_PROJECT_ID = "environment-route-other-project";
const originalDevUserId = process.env.DEV_USER_ID;
process.env.DEV_USER_ID = DEV_USER_ID;

async function cleanDatabase(): Promise<void> {
  const projectIds = [PROJECT_ID, OTHER_PROJECT_ID];
  await prisma.projectEnvironment.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.message.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.sessionRuntimeState.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.session.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.tokenUsage.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [DEV_USER_ID, OTHER_USER_ID] } } });
}

async function createOwnedProject(): Promise<void> {
  await prisma.user.create({ data: { id: DEV_USER_ID, email: "environment-route-user@example.com" } });
  await prisma.project.create({ data: { id: PROJECT_ID, ownerId: DEV_USER_ID, name: "Env Project" } });
}

describe("/api/projects/[id]/environment", () => {
  afterAll(() => {
    if (originalDevUserId === undefined) delete process.env.DEV_USER_ID;
    else process.env.DEV_USER_ID = originalDevUserId;
  });

  beforeEach(async () => {
    process.env.DEV_USER_ID = DEV_USER_ID;
    await cleanDatabase();
  });

  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns empty content when no environment is saved", async () => {
    await createOwnedProject();

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ content: "", updatedAt: null });
  });

  it("upserts and returns saved dotenv content", async () => {
    await createOwnedProject();
    const content = "NEXT_PUBLIC_SITE_URL=https://example.com\n# keep comment\nSECRET=value\n";

    const put = await PUT(new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(put.status).toBe(200);
    const putBody = await put.json() as { content: string; updatedAt: string | null };
    expect(putBody.content).toBe(content);
    expect(typeof putBody.updatedAt).toBe("string");

    const get = await GET(new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });
    expect(get.status).toBe(200);
    const getBody = await get.json() as { content: string; updatedAt: string | null };
    expect(getBody.content).toBe(content);
    expect(typeof getBody.updatedAt).toBe("string");
  });

  it("returns 404 for another user's project", async () => {
    await prisma.user.create({ data: { id: OTHER_USER_ID, email: "environment-route-other@example.com" } });
    await prisma.project.create({ data: { id: OTHER_PROJECT_ID, ownerId: OTHER_USER_ID, name: "Other" } });

    const res = await GET(new Request(`http://localhost/api/projects/${OTHER_PROJECT_ID}/environment`), {
      params: Promise.resolve({ id: OTHER_PROJECT_ID }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects non-string content", async () => {
    await createOwnedProject();

    const res = await PUT(new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: 123 }),
    }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "content must be a string" });
  });

  it("rejects content larger than 64 KiB", async () => {
    await createOwnedProject();
    const content = "A".repeat(64 * 1024 + 1);

    const res = await PUT(new Request(`http://localhost/api/projects/${PROJECT_ID}/environment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }), {
      params: Promise.resolve({ id: PROJECT_ID }),
    });

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: "content is too large" });
  });
});
```

- [ ] **Step 3: Run API tests and verify RED**

Run:

```bash
pnpm test:host app/api/projects/[id]/environment/__tests__/route.test.ts
```

Expected: fail because `projectEnvironment` and route module do not exist.

- [ ] **Step 4: Add Prisma schema and migration**

Update `prisma/schema.prisma`:

```prisma
model Project {
  id                   String        @id @default(cuid())
  ownerId              String
  owner                User          @relation(fields: [ownerId], references: [id])
  name                 String
  status               ProjectStatus @default(PROVISIONING)
  agentRuntime         AgentRuntime  @default(CLAUDE_CODE)
  desiredRuntime       AgentRuntime  @default(CLAUDE_CODE)
  runtimeSwitchStatus  RuntimeSwitchStatus @default(IDLE)
  runtimeGeneration    Int           @default(1)
  createdAt            DateTime      @default(now())
  lastActive           DateTime      @default(now())

  daytonaSandboxId     String?
  brokerUrl            String?
  brokerPreviewToken   String?
  previewUrl           String?
  provisioningError    String?

  environment          ProjectEnvironment?
  sessions             Session[]
  sessionRuntimeStates SessionRuntimeState[]
  messages             Message[]
  tokenUsages          TokenUsage[]

  @@index([ownerId])
}

model ProjectEnvironment {
  projectId String   @id
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  content   String   @db.Text
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
}
```

Create `prisma/migrations/20260503120000_add_project_environment/migration.sql`:

```sql
CREATE TABLE "ProjectEnvironment" (
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("projectId")
);

ALTER TABLE "ProjectEnvironment"
ADD CONSTRAINT "ProjectEnvironment_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
```

Run:

```bash
pnpm exec prisma generate
```

- [ ] **Step 5: Add environment route implementation**

Create `app/api/projects/[id]/environment/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";
const MAX_ENV_BYTES = 64 * 1024;

function serializeEnvironment(row: { content: string; updatedAt: Date } | null) {
  return {
    content: row?.content ?? "",
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

async function findOwnedProject(id: string): Promise<{ id: string } | null> {
  return prisma.project.findFirst({
    where: { id, ownerId: DEV_USER_ID },
    select: { id: true },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await findOwnedProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const environment = await prisma.projectEnvironment.findUnique({
    where: { projectId: project.id },
    select: { content: true, updatedAt: true },
  });
  return NextResponse.json(serializeEnvironment(environment));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await findOwnedProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_ENV_BYTES) {
    return NextResponse.json({ error: "content is too large" }, { status: 413 });
  }

  const environment = await prisma.projectEnvironment.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, content: body.content },
    update: { content: body.content },
    select: { content: true, updatedAt: true },
  });
  return NextResponse.json(serializeEnvironment(environment));
}
```

- [ ] **Step 6: Run API tests and verify GREEN**

Run:

```bash
pnpm test:host app/api/projects/[id]/environment/__tests__/route.test.ts
```

Expected: all tests in the new file pass.

- [ ] **Step 7: Commit API/data model**

```bash
git add prisma/schema.prisma prisma/migrations/20260503120000_add_project_environment/migration.sql app/api/projects/[id]/environment
git commit -m "feat: persist project environment for T-20260503-007"
```

## Task 2: Runtime Spawn Env Propagation

**Files:**
- Modify: `lib/runtime/types.ts`
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Modify: `lib/runtime/worker-pool/__tests__/runtime.test.ts`
- Modify: `lib/runtime/daytona/fake.ts`
- Modify: `lib/runtime/daytona/__tests__/fake.test.ts`
- Modify: `lib/runtime/daytona/cloud.ts`

- [ ] **Step 1: Write failing worker-pool runtime test**

Append to `lib/runtime/worker-pool/__tests__/runtime.test.ts`:

```ts
  it("passes project env content as base64 to the worker sandbox", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    const content = "NEXT_PUBLIC_SITE_URL=https://example.com\nSECRET=value\n";

    await r.spawnProjectSandbox({
      projectId,
      cloneToken: "x",
      repoOwner: "x",
      repoName: "x",
      projectEnvContent: content,
    });

    const [created] = handles.created();
    expect(created.env.PROJECT_ENV_B64).toBe(Buffer.from(content, "utf8").toString("base64"));
  });
```

If `createFakeAgentClient()` does not expose `created()`, add the minimal test helper in the same task after watching the test fail.

- [ ] **Step 2: Write failing fake runtime test**

Append to `lib/runtime/daytona/__tests__/fake.test.ts`:

```ts
  it("writes project env content into .env", async () => {
    client = createFakeClient();
    const content = "NEXT_PUBLIC_SITE_URL=https://example.com\nSECRET=value\n";
    const info = await client.spawnProjectSandbox({
      projectId: "p-env",
      cloneToken: "",
      repoOwner: "",
      repoName: "",
      projectEnvContent: content,
    });
    spawnedIds.push(info.sandboxId);

    const ws = new WebSocket(info.brokerUrl);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once("open", () => ws.send(JSON.stringify({
        type: "file.read",
        requestId: "env-read",
        path: ".env",
      })));
      ws.once("message", (d) => resolve(d.toString()));
      ws.once("error", reject);
    });

    expect(JSON.parse(reply)).toEqual({
      type: "file.content",
      requestId: "env-read",
      path: ".env",
      content,
    });
    ws.close();
  });
```

- [ ] **Step 3: Run runtime tests and verify RED**

Run:

```bash
pnpm test:host lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/daytona/__tests__/fake.test.ts
```

Expected: fail because `projectEnvContent` and helper support are missing.

- [ ] **Step 4: Extend `SpawnArgs`**

In `lib/runtime/types.ts`:

```ts
export interface SpawnArgs {
  projectId: string;
  cloneToken: string;
  repoOwner: string;
  repoName: string;
  projectEnvContent?: string;
}
```

- [ ] **Step 5: Pass encoded env through worker-pool**

In `lib/runtime/worker-pool/runtime.ts`, add helper:

```ts
function projectEnvForSandbox(content: string | undefined): Record<string, string> {
  if (!content) return {};
  return { PROJECT_ENV_B64: Buffer.from(content, "utf8").toString("base64") };
}
```

Then build env as:

```ts
const env: Record<string, string> = {
  PROJECT_ID: spawn.projectId,
  BROKER_TOKEN: brokerToken,
  ...projectEnvForSandbox(spawn.projectEnvContent),
  ...args.brokerEnv?.(),
};
```

- [ ] **Step 6: Add fake agent captured request helper if needed**

If the test needs it, update `lib/runtime/worker-pool/fake-agent-client.ts` with:

```ts
const createdRequests: CreateSandboxRequest[] = [];

async createSandbox(req: CreateSandboxRequest): Promise<CreateSandboxResponse> {
  createdRequests.push(req);
  // keep existing behavior after this line
}

return {
  client,
  list: () => Array.from(sandboxes.values()),
  created: () => createdRequests.slice(),
  failNext,
};
```

Keep existing exported shape compatible.

- [ ] **Step 7: Write env in fake runtime**

In `lib/runtime/daytona/fake.ts`, import `writeFile` and write after template copy:

```ts
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
```

Inside `spawnProjectSandbox` after `cp(...)`:

```ts
if (projectEnvContent) {
  await writeFile(join(projectRoot, ".env"), projectEnvContent, "utf8");
}
```

Update the parameter destructuring:

```ts
async spawnProjectSandbox({ projectId, projectEnvContent }: SpawnArgs): Promise<SandboxInfo> {
```

- [ ] **Step 8: Encode env for Daytona Cloud boot**

In `lib/runtime/daytona/cloud.ts`, add:

```ts
function base64ForShell(value: string | undefined): string {
  return value ? Buffer.from(value, "utf8").toString("base64") : "";
}
```

Extend `buildBootCommand` args with `projectEnvContent?: string`. After `cd repo` and before `corepack enable pnpm`, add:

```ts
const envB64 = base64ForShell(args.projectEnvContent);
const writeEnvStep = envB64
  ? `printf '%s' '${envB64}' | base64 -d > /workspace/repo/container/sandbox/project-template/.env`
  : `true`;
```

Include `writeEnvStep` in `setupSteps` after `cd repo`. Pass `projectEnvContent` from `spawnProjectSandbox` into `buildBootCommand`.

If the Daytona path should write into the user project rather than the builder template after repo checkout behavior changes, update the write path to the actual seeded project path during implementation.

- [ ] **Step 9: Run runtime tests and verify GREEN**

Run:

```bash
pnpm test:host lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/daytona/__tests__/fake.test.ts
```

Expected: both files pass.

- [ ] **Step 10: Commit runtime propagation**

```bash
git add lib/runtime/types.ts lib/runtime/worker-pool/runtime.ts lib/runtime/worker-pool/fake-agent-client.ts lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/daytona/fake.ts lib/runtime/daytona/cloud.ts lib/runtime/daytona/__tests__/fake.test.ts
git commit -m "feat: propagate project env to sandboxes for T-20260503-007"
```

## Task 3: Sandbox Entrypoint Decode

**Files:**
- Modify: `container/sandbox/entrypoint.sh`

- [ ] **Step 1: Write shell verification command before editing**

Run current syntax check:

```bash
sh -n container/sandbox/entrypoint.sh
```

Expected: exit 0.

- [ ] **Step 2: Add env decode block**

In `container/sandbox/entrypoint.sh`, after `cd /workspace/project` and before git initialization:

```sh
if [ -n "${PROJECT_ENV_B64:-}" ]; then
  echo "[entrypoint] writing project .env"
  printf '%s' "${PROJECT_ENV_B64}" | base64 -d > /workspace/project/.env
fi
```

Do not echo decoded content.

- [ ] **Step 3: Verify shell syntax**

Run:

```bash
sh -n container/sandbox/entrypoint.sh
```

Expected: exit 0.

- [ ] **Step 4: Verify decode behavior with a temporary shell fixture**

Run:

```bash
tmp="$(mktemp -d)"
PROJECT_ENV_B64="$(printf 'A=1\nB=two\n' | base64)" sh -c 'mkdir -p "$1"; cd "$1"; if [ -n "${PROJECT_ENV_B64:-}" ]; then printf "%s" "${PROJECT_ENV_B64}" | base64 -d > "$1/.env"; fi; test "$(cat "$1/.env")" = "$(printf "A=1\nB=two")"' sh "$tmp"
rm -rf "$tmp"
```

Expected: exit 0.

- [ ] **Step 5: Commit entrypoint**

```bash
git add container/sandbox/entrypoint.sh
git commit -m "feat: write project env file during sandbox boot for T-20260503-007"
```

## Task 4: Load Saved Env During Host Spawn

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Optional Test: `app/api/projects/__tests__/route.test.ts` if route mocking is already practical

- [ ] **Step 1: Add helper in project creation route**

In `app/api/projects/route.ts`, after project creation and before spawn:

```ts
async function projectEnvContent(projectId: string): Promise<string | undefined> {
  const row = await prisma.projectEnvironment.findUnique({
    where: { projectId },
    select: { content: true },
  });
  return row?.content || undefined;
}
```

Then pass:

```ts
projectEnvContent: await projectEnvContent(project.id),
```

into `spawnProjectSandbox`.

- [ ] **Step 2: Pass saved env during fake respawn**

In `app/api/projects/[id]/route.ts`, add the same helper or inline query and pass:

```ts
projectEnvContent: await projectEnvContent(project.id),
```

to the fake runtime respawn call.

- [ ] **Step 3: Typecheck the route changes**

Run:

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: no TypeScript errors from the changed spawn calls.

- [ ] **Step 4: Commit host spawn integration**

```bash
git add app/api/projects/route.ts app/api/projects/[id]/route.ts
git commit -m "feat: load project env for sandbox spawn for T-20260503-007"
```

## Task 5: Workspace Env UI And Sync

**Files:**
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Identify UI insertion point**

Read the toolbar and file write helpers:

```bash
sed -n '360,560p' 'app/project/[id]/page.tsx'
sed -n '1500,1900p' 'app/project/[id]/page.tsx'
```

- [ ] **Step 2: Add Env state and constants**

Add imports:

```ts
import { KeyRound, Save } from "lucide-react";
```

Add constants near other file path constants:

```ts
const PROJECT_ENV_PATH = ".env";
```

Add state near preview/devtool state:

```ts
const [envPanelOpen, setEnvPanelOpen] = useState(false);
const [envContent, setEnvContent] = useState("");
const [envContentBase, setEnvContentBase] = useState("");
const [envLoading, setEnvLoading] = useState(false);
const [envSaving, setEnvSaving] = useState(false);
const [envError, setEnvError] = useState<string | null>(null);
const [envSyncWarning, setEnvSyncWarning] = useState<string | null>(null);
```

- [ ] **Step 3: Add API load/save helpers**

Add inside `ProjectWorkspace`:

```ts
const loadProjectEnv = useCallback(async () => {
  setEnvLoading(true);
  setEnvError(null);
  try {
    const res = await fetch(`/api/projects/${id}/environment`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { content: string; updatedAt: string | null };
    setEnvContent(data.content);
    setEnvContentBase(data.content);
    setEnvSyncWarning(null);
  } catch (err) {
    setEnvError(err instanceof Error ? err.message : "environment could not be loaded");
  } finally {
    setEnvLoading(false);
  }
}, [id]);

async function openEnvPanel() {
  setEnvPanelOpen(true);
  if (!envContent && !envContentBase) {
    await loadProjectEnv();
  }
}

async function saveProjectEnv() {
  if (turnInFlight !== null || envSaving) return;
  setEnvSaving(true);
  setEnvError(null);
  setEnvSyncWarning(null);
  try {
    const res = await fetch(`/api/projects/${id}/environment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: envContent }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { content: string; updatedAt: string | null };
    setEnvContent(data.content);
    setEnvContentBase(data.content);

    try {
      await writeProjectFile(PROJECT_ENV_PATH, data.content);
      setPaths((prev) => (prev.includes(PROJECT_ENV_PATH) ? prev : [...prev, PROJECT_ENV_PATH].sort()));
      if (selectedPathRef.current === PROJECT_ENV_PATH) {
        setFileContent(data.content);
        setFileContentBase(data.content);
      }
    } catch (err) {
      setEnvSyncWarning(err instanceof Error ? err.message : "sandbox sync failed");
    }
  } catch (err) {
    setEnvError(err instanceof Error ? err.message : "environment could not be saved");
  } finally {
    setEnvSaving(false);
  }
}
```

- [ ] **Step 4: Add Env toolbar action**

In `RightPane` props, add `codeActions`:

```tsx
codeActions={
  <Button
    type="button"
    variant={envPanelOpen ? "secondary" : "ghost"}
    size="xs"
    onClick={() => void openEnvPanel()}
    disabled={wsStatus !== "open"}
    aria-pressed={envPanelOpen}
    aria-label="Edit project environment"
  >
    <KeyRound />
    Env
  </Button>
}
```

- [ ] **Step 5: Render Env panel in code pane**

Inside the code pane wrapper, before the editor area or as a right-side panel:

```tsx
{envPanelOpen && (
  <section className="flex w-[min(420px,45%)] min-w-80 shrink-0 flex-col border-r border-border bg-background">
    <div className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <KeyRound className="size-4 text-primary" aria-hidden="true" />
        <span className="truncate">Environment</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close environment editor"
        onClick={() => setEnvPanelOpen(false)}
      >
        <X />
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <label className="grid min-h-0 flex-1 gap-2">
        <span className="text-xs font-medium text-muted-foreground">.env content</span>
        <Textarea
          value={envContent}
          onChange={(e) => setEnvContent(e.target.value)}
          spellCheck={false}
          disabled={envLoading || envSaving || turnInFlight !== null}
          className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
          placeholder={"NEXT_PUBLIC_SITE_URL=https://example.com\nAPI_KEY=..."}
        />
      </label>
      {(envError || envSyncWarning) && (
        <div role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 p-2 text-xs text-red-200">
          {envError ?? `Saved, but sandbox sync failed: ${envSyncWarning}`}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-muted-foreground">
          {envContent !== envContentBase ? "Unsaved changes" : envLoading ? "Loading..." : "Saved"}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={envLoading || envSaving || turnInFlight !== null || envContent === envContentBase}
          onClick={() => void saveProjectEnv()}
        >
          {envSaving ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
    </div>
  </section>
)}
```

Adjust widths responsively if needed so the file tree, Env panel, and editor do not overlap.

- [ ] **Step 6: Manual browser verification**

Start dev server if not running:

```bash
pnpm dev
```

Open a running project, click `Env`, paste `NEXT_PUBLIC_SITE_URL=https://example.com`, save, then open `.env` in the file tree and confirm the content is present.

- [ ] **Step 7: Commit UI**

```bash
git add app/project/[id]/page.tsx
git commit -m "feat: add workspace env editor for T-20260503-007"
```

## Task 6: Final Verification And Docs

**Files:**
- Modify: `TASKS.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run focused tests**

```bash
pnpm test:host app/api/projects/[id]/environment/__tests__/route.test.ts lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/daytona/__tests__/fake.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: exit 0.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: exit 0. If environment configuration blocks the build, capture the exact blocker and record it in the final report.

- [ ] **Step 4: Update task journal and changelog**

In `TASKS.md`, set `T-20260503-007` to `Done` if verification passes or `Blocked` if a required verification step is blocked.

In `CHANGELOG.md`, add a concise entry under `2026-05-03`:

```md
- T-20260503-007: Added durable project environment management with DB persistence, workspace `.env` editing, and sandbox boot synchronization.
```

- [ ] **Step 5: Commit docs/status**

```bash
git add TASKS.md CHANGELOG.md
git commit -m "docs: record project env management completion for T-20260503-007"
```

## Self-Review

- Spec coverage: data persistence is covered by Task 1; current sandbox sync is covered by Task 5; new sandbox boot sync is covered by Tasks 2-4; security constraints are covered by API limits and no-log shell behavior; verification is covered by Task 6.
- Placeholder scan: no unresolved placeholder markers or unspecified implementation steps remain.
- Type consistency: the plan uses `projectEnvContent?: string` consistently in `SpawnArgs`, route calls, and runtime implementations.
