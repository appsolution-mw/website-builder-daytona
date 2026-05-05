# Managed Hetzner Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-managed Hetzner worker pool with per-worker project slots, elastic sandbox placement, and Cloudflare/Caddy-backed public project subdomains.

**Architecture:** Extend the existing `WorkerPoolRuntime` instead of replacing it. H.1c adds admin-created Hetzner workers, Tailscale bootstrap, live worker-agent health, and slot scheduling behind `RUNTIME_MODE=worker-pool-hetzner`; H.1d adds Caddy route application and wildcard TLS-backed project preview URLs.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/Postgres, Vitest, Hetzner Cloud API, Tailscale API, Docker worker-agent, Caddy with Cloudflare DNS-01.

---

## File Structure

### Database

- Modify `prisma/schema.prisma`
  - Rename `Project.daytonaSandboxId` to `sandboxId`.
  - Add `Project.publicSlug`.
  - Add `Worker.name`, `Worker.serverType`, `Worker.provisioningError`, `Worker.readyAt`.
  - Remove Prisma-level `WorkerSandbox.projectId @unique`.
- Create `prisma/migrations/20260505180000_managed_worker_pool/migration.sql`
  - Rename project sandbox column.
  - Add worker and project fields.
  - Replace the project unique constraint with a partial unique index for active worker sandboxes.

### Runtime

- Modify `lib/runtime/types.ts`
  - Add optional worker-management metadata to `WorkerRecord`.
  - Add typed capacity/provisioning error shape.
- Create `lib/runtime/errors.ts`
  - Typed runtime errors, starting with `NO_WORKER_CAPACITY`.
- Modify `lib/runtime/scheduler/simple.ts`
  - Count slot-consuming statuses.
  - Pick least-loaded worker by used slot count.
- Create `lib/runtime/provisioner/hetzner-client.ts`
  - Thin fetch client for Hetzner server create/delete/get/list.
- Create `lib/runtime/provisioner/tailscale-client.ts`
  - Thin fetch client for auth-key creation and device lookup by hostname.
- Create `lib/runtime/provisioner/cloud-init.ts`
  - Render cloud-init for Docker, Tailscale, and worker-agent startup.
- Create `lib/runtime/provisioner/hetzner.ts`
  - `WorkerProvisioner` implementation for live Hetzner workers.
- Modify `lib/runtime/worker-pool/runtime.ts`
  - Throw `NO_WORKER_CAPACITY` when scheduler returns null in Hetzner mode.
  - Keep local mode able to provision through `FakeProvisioner`.
- Modify `lib/runtime/worker-pool/index.ts`
  - Add `createHetznerWorkerPoolRuntime`.
  - Keep `createLocalWorkerPoolRuntime` unchanged.
- Modify `lib/runtime/index.ts`
  - Wire `RUNTIME_MODE=worker-pool-hetzner`.

### Admin APIs

- Create `lib/admin/workers.ts`
  - Shared worker serialization, slot counting, validation, and admin action helpers.
- Create `app/api/admin/workers/route.ts`
  - `GET` list workers with slot counts.
  - `POST` create Hetzner worker.
- Create `app/api/admin/workers/[id]/drain/route.ts`
  - Mark ready/offline worker as draining.
- Create `app/api/admin/workers/[id]/retry/route.ts`
  - Retry provisioning for failed Hetzner workers.
- Create `app/api/admin/workers/[id]/route.ts`
  - `DELETE` decommission an empty worker.

### Admin UI

- Create `app/admin/workers/page.tsx`
  - Server component shell.
- Create `app/admin/workers/WorkersClient.tsx`
  - Client-side worker table, create form, refresh, drain, retry, decommission.
- Modify `app/page.tsx`
  - Add a small nav link to `/admin/workers`.

### Project Lifecycle

- Modify `app/api/projects/route.ts`
  - Store `sandboxId`.
  - Show `NO_WORKER_CAPACITY` as a clear message.
  - Generate `publicSlug` when a project is created.
- Modify `app/api/projects/[id]/route.ts`
  - Use `sandboxId`.
  - Keep fake Daytona compatibility by checking old fake ID shape only through the renamed field.
- Modify `app/api/projects/[id]/restart/route.ts`
  - Use `sandboxId`.
  - Destroy old sandbox before scheduling new one so restart can move workers.

### Public Routing

- Create `lib/routing/project-slug.ts`
  - Stable slug generation.
- Create `lib/routing/caddy-config.ts`
  - Build Caddy JSON route patches for project preview hostnames.
- Create `lib/routing/caddy-client.ts`
  - Apply/update/delete Caddy routes through the admin API.
- Modify `lib/runtime/worker-pool/runtime.ts`
  - Optional route application hook after sandbox creation and destruction.
- Add H.1d env validation to the routing client without requiring those env vars for H.1c.

### Tests

- Create tests next to each new module:
  - `lib/runtime/provisioner/__tests__/hetzner-client.test.ts`
  - `lib/runtime/provisioner/__tests__/tailscale-client.test.ts`
  - `lib/runtime/provisioner/__tests__/cloud-init.test.ts`
  - `lib/runtime/provisioner/__tests__/hetzner.test.ts`
  - `lib/runtime/__tests__/errors.test.ts`
  - `lib/admin/__tests__/workers.test.ts`
  - `app/api/admin/workers/__tests__/route.test.ts`
  - `app/api/admin/workers/[id]/__tests__/route.test.ts`
  - `lib/routing/__tests__/project-slug.test.ts`
  - `lib/routing/__tests__/caddy-config.test.ts`
  - `lib/routing/__tests__/caddy-client.test.ts`
- Modify existing tests:
  - `lib/runtime/scheduler/__tests__/simple.test.ts`
  - `lib/runtime/worker-pool/__tests__/runtime.test.ts`
  - `lib/runtime/worker-pool/__tests__/index.test.ts`
  - `lib/runtime/__tests__/index.test.ts`
  - `app/api/projects/__tests__/route.test.ts`
  - `app/api/projects/[id]/restart/__tests__/route.test.ts`

---

## Task 1: Read Next.js 16 Docs And Confirm Baseline

**Files:**
- Read: `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- Read: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- Read: `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

- [ ] **Step 1: Re-read local Next.js route handler docs**

Run:

```bash
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

Expected: documentation confirms App Router `route.ts` files, supported HTTP methods, and request-time behavior.

- [ ] **Step 2: Re-read server/client component docs**

Run:

```bash
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

Expected: documentation confirms pages are Server Components by default and interactive worker admin controls need a focused Client Component.

- [ ] **Step 3: Re-read environment variable docs**

Run:

```bash
sed -n '1,180p' node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
```

Expected: documentation confirms non-`NEXT_PUBLIC_` env vars stay server-only.

- [ ] **Step 4: Capture current verification baseline**

Run:

```bash
pnpm test:host --runInBand
```

Expected: if the runner rejects `--runInBand`, rerun `pnpm test:host`. Existing host tests should pass before changes. Record any pre-existing failure in the task file before implementation.

- [ ] **Step 5: Commit is not needed**

No commit for read-only baseline inspection.

---

## Task 2: Add Database Shape For Managed Workers And Elastic Sandboxes

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260505180000_managed_worker_pool/migration.sql`
- Modify tests that seed `Worker`: add `name` when schema requires it.

- [ ] **Step 1: Update Prisma schema**

In `prisma/schema.prisma`, change the `Project` sandbox fields to:

```prisma
  sandboxId            String?
  brokerUrl            String?
  brokerPreviewToken   String?
  previewUrl           String?
  publicSlug           String?             @unique
  provisioningError    String?
```

In `Worker`, add fields:

```prisma
  name              String
  serverType        String?
  provisioningError String?
  readyAt           DateTime?
```

In `WorkerSandbox`, change:

```prisma
  projectId      String
```

Remove the existing `@unique` from `projectId`.

- [ ] **Step 2: Create migration SQL**

Create `prisma/migrations/20260505180000_managed_worker_pool/migration.sql` with this shape:

```sql
ALTER TABLE "Project" RENAME COLUMN "daytonaSandboxId" TO "sandboxId";

ALTER TABLE "Project" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "Project_publicSlug_key" ON "Project"("publicSlug");

ALTER TABLE "Worker" ADD COLUMN "name" TEXT;
UPDATE "Worker"
SET "name" = COALESCE(NULLIF("tailscaleHostname", ''), 'Worker ' || "id")
WHERE "name" IS NULL;
ALTER TABLE "Worker" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Worker" ADD COLUMN "serverType" TEXT;
ALTER TABLE "Worker" ADD COLUMN "provisioningError" TEXT;
ALTER TABLE "Worker" ADD COLUMN "readyAt" TIMESTAMP(3);

ALTER TABLE "WorkerSandbox" DROP CONSTRAINT IF EXISTS "WorkerSandbox_projectId_key";

CREATE UNIQUE INDEX "WorkerSandbox_active_projectId_key"
ON "WorkerSandbox"("projectId")
WHERE "status" <> 'DESTROYED';
```

- [ ] **Step 3: Update generated Prisma client**

Run:

```bash
pnpm db:migrate --name managed_worker_pool
```

Expected: migration applies to the development database and Prisma client regenerates.

- [ ] **Step 4: Fix seed/test compile errors from required `Worker.name`**

Every direct `prisma.worker.create` in tests must include `name`, for example:

```ts
name: `${TEST_PREFIX}worker-${suffix}`,
```

Use:

```bash
rg -n "prisma\\.worker\\.create" lib app worker-agent
```

Expected: every worker create call has `name` in `data`.

- [ ] **Step 5: Run schema-focused tests**

Run:

```bash
pnpm test:host -- lib/runtime/scheduler/__tests__/simple.test.ts lib/runtime/provisioner/__tests__/fake.test.ts
```

Expected: tests compile and either pass or fail only because later scheduler changes are not implemented yet.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib app
git commit -m "feat: add managed worker pool schema for T-20260505-014"
```

---

## Task 3: Add Runtime Error Types

**Files:**
- Create: `lib/runtime/errors.ts`
- Create: `lib/runtime/__tests__/errors.test.ts`

- [ ] **Step 1: Write tests**

Create `lib/runtime/__tests__/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuntimeError, isRuntimeError } from "../errors";

describe("RuntimeError", () => {
  it("carries a stable code and safe message", () => {
    const error = new RuntimeError("NO_WORKER_CAPACITY", "No ready worker has a free project slot");
    expect(error.name).toBe("RuntimeError");
    expect(error.code).toBe("NO_WORKER_CAPACITY");
    expect(error.message).toBe("No ready worker has a free project slot");
  });

  it("narrows unknown errors by code", () => {
    const error = new RuntimeError("NO_WORKER_CAPACITY", "No ready worker has a free project slot");
    expect(isRuntimeError(error, "NO_WORKER_CAPACITY")).toBe(true);
    expect(isRuntimeError(new Error("x"), "NO_WORKER_CAPACITY")).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test:host -- lib/runtime/__tests__/errors.test.ts
```

Expected: fails because `lib/runtime/errors.ts` does not exist.

- [ ] **Step 3: Implement runtime errors**

Create `lib/runtime/errors.ts`:

```ts
export type RuntimeErrorCode = "NO_WORKER_CAPACITY";

export class RuntimeError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export function isRuntimeError(error: unknown, code: RuntimeErrorCode): error is RuntimeError {
  return error instanceof RuntimeError && error.code === code;
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
pnpm test:host -- lib/runtime/__tests__/errors.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/errors.ts lib/runtime/__tests__/errors.test.ts
git commit -m "feat: add runtime capacity errors for T-20260505-014"
```

---

## Task 4: Update Scheduler Slot Semantics

**Files:**
- Modify: `lib/runtime/scheduler/simple.ts`
- Modify: `lib/runtime/scheduler/__tests__/simple.test.ts`

- [ ] **Step 1: Update scheduler tests**

In `lib/runtime/scheduler/__tests__/simple.test.ts`, update worker seeds with `name`, then change the paused/stopped behavior test to count stopped sandboxes as occupied:

```ts
async function seedWorker(args: {
  capacity: number;
  status?: WorkerStatus;
  provider?: string;
  region?: string;
}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return prisma.worker.create({
    data: {
      name: `worker-${suffix}`,
      tailscaleHostname: `w-${suffix}`,
      tailscaleIp: "100.64.1.1",
      provider: args.provider ?? "fake",
      providerVmId: "vm",
      region: args.region ?? "fsn1",
      capacity: args.capacity,
      status: args.status ?? "READY",
    },
  });
}
```

Replace the old paused/destroyed test with:

```ts
it("counts stopped sandboxes against capacity but ignores destroyed sandboxes", async () => {
  const w = await seedWorker({ capacity: 2 });
  await seedSandbox(w.id, "p1", "STOPPED");
  await seedSandbox(w.id, "p2", "DESTROYED");
  await seedSandbox(w.id, "p3", "RUNNING");
  const s = createSimpleScheduler();
  expect(await s.pickWorker({})).toBeNull();
});
```

Add:

```ts
it("picks the least used ready worker", async () => {
  const a = await seedWorker({ capacity: 10 });
  const b = await seedWorker({ capacity: 10 });
  await seedSandbox(a.id, "p1", "RUNNING");
  await seedSandbox(a.id, "p2", "SPAWNING");
  await seedSandbox(b.id, "p3", "RUNNING");

  const s = createSimpleScheduler();
  const picked = await s.pickWorker({});
  expect(picked?.id).toBe(b.id);
});
```

- [ ] **Step 2: Run failing scheduler tests**

Run:

```bash
pnpm test:host -- lib/runtime/scheduler/__tests__/simple.test.ts
```

Expected: fails until `STOPPED` is counted and least-used selection is implemented.

- [ ] **Step 3: Implement slot-consuming statuses**

Update `lib/runtime/scheduler/simple.ts`:

```ts
const SLOT_CONSUMING_SANDBOX_STATUSES = ["SPAWNING", "RUNNING", "STOPPED"] as const;
```

Change the count query to use `SLOT_CONSUMING_SANDBOX_STATUSES`.

Change the selection loop to choose the lowest used count, tie-breaking by most free slots:

```ts
let best: { worker: typeof workers[number]; used: number; free: number } | null = null;
for (const w of workers) {
  const used = w._count.sandboxes;
  const free = w.capacity - used;
  if (free <= 0) continue;
  if (
    !best ||
    used < best.used ||
    (used === best.used && free > best.free)
  ) {
    best = { worker: w, used, free };
  }
}
```

- [ ] **Step 4: Run passing scheduler tests**

Run:

```bash
pnpm test:host -- lib/runtime/scheduler/__tests__/simple.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/scheduler/simple.ts lib/runtime/scheduler/__tests__/simple.test.ts
git commit -m "feat: schedule projects by worker slots for T-20260505-014"
```

---

## Task 5: Add Project Public Slug Generation

**Files:**
- Create: `lib/routing/project-slug.ts`
- Create: `lib/routing/__tests__/project-slug.test.ts`

- [ ] **Step 1: Write slug tests**

Create `lib/routing/__tests__/project-slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProjectPublicSlugCandidate } from "../project-slug";

describe("createProjectPublicSlugCandidate", () => {
  it("normalizes project names for DNS labels", () => {
    expect(createProjectPublicSlugCandidate("Marketing Site Refresh")).toBe("marketing-site-refresh");
    expect(createProjectPublicSlugCandidate("Müller & Söhne")).toBe("muller-sohne");
    expect(createProjectPublicSlugCandidate("  Hello___World!!! ")).toBe("hello-world");
  });

  it("falls back for empty names and caps length", () => {
    expect(createProjectPublicSlugCandidate("!!!")).toBe("project");
    expect(createProjectPublicSlugCandidate("a".repeat(80))).toHaveLength(48);
  });
});
```

- [ ] **Step 2: Run failing slug tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/project-slug.test.ts
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement slug helper**

Create `lib/routing/project-slug.ts`:

```ts
const MAX_DNS_LABEL_LENGTH = 48;

export function createProjectPublicSlugCandidate(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_DNS_LABEL_LENGTH)
    .replace(/-+$/g, "");

  return normalized || "project";
}
```

- [ ] **Step 4: Run passing slug tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/project-slug.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/routing/project-slug.ts lib/routing/__tests__/project-slug.test.ts
git commit -m "feat: add project subdomain slug helper for T-20260505-014"
```

---

## Task 6: Store `sandboxId` And `publicSlug` In Project Create/Restart/Delete

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/projects/[id]/restart/route.ts`
- Modify tests under `app/api/projects/**/__tests__`

- [ ] **Step 1: Update project route tests**

In project create tests, assert created projects receive `publicSlug` and use `sandboxId`:

```ts
expect(project.publicSlug).toMatch(/^test-project/);
expect(project.sandboxId).toBe("sandbox-new");
```

In restart tests, update seed and assertions:

```ts
sandboxId: "sandbox-old",
```

and:

```ts
expect(destroyProjectSandboxMock).toHaveBeenCalledWith("sandbox-old");
expect(updated.sandboxId).toBe("sandbox-new");
```

- [ ] **Step 2: Run failing project route tests**

Run:

```bash
pnpm test:host -- app/api/projects/__tests__/route.test.ts app/api/projects/[id]/restart/__tests__/route.test.ts
```

Expected: fail until route code uses renamed fields and slug generation.

- [ ] **Step 3: Add unique slug helper inside `app/api/projects/route.ts`**

Import:

```ts
import { createProjectPublicSlugCandidate } from "@/lib/routing/project-slug";
```

Add helper:

```ts
async function uniquePublicSlug(name: string): Promise<string> {
  const base = createProjectPublicSlugCandidate(name);
  for (let i = 0; i < 100; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.project.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error("could not allocate public slug");
}
```

- [ ] **Step 4: Update project create data**

In `app/api/projects/route.ts`, add to `project.create.data`:

```ts
publicSlug: await uniquePublicSlug(name),
```

Replace updates to `daytonaSandboxId` with:

```ts
sandboxId: info.sandboxId,
```

- [ ] **Step 5: Update project GET/DELETE and restart routes**

In `app/api/projects/[id]/route.ts` and `app/api/projects/[id]/restart/route.ts`, replace `daytonaSandboxId` with `sandboxId`. Keep fake compatibility checks:

```ts
project.sandboxId?.startsWith("fake-")
```

- [ ] **Step 6: Run passing project tests**

Run:

```bash
pnpm test:host -- app/api/projects/__tests__/route.test.ts app/api/projects/[id]/restart/__tests__/route.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/projects lib/routing prisma/schema.prisma
git commit -m "feat: store elastic sandbox identity for T-20260505-014"
```

---

## Task 7: Add Hetzner And Tailscale API Clients

**Files:**
- Create: `lib/runtime/provisioner/hetzner-client.ts`
- Create: `lib/runtime/provisioner/tailscale-client.ts`
- Create: `lib/runtime/provisioner/__tests__/hetzner-client.test.ts`
- Create: `lib/runtime/provisioner/__tests__/tailscale-client.test.ts`

- [ ] **Step 1: Write Hetzner client tests**

Create tests that mock `global.fetch` and verify:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://api.hetzner.cloud/v1/servers",
  expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({
      authorization: "Bearer hcloud-token",
      "content-type": "application/json",
    }),
  }),
);
```

Assert create returns:

```ts
{
  id: "123",
  name: "wbd-worker-a",
  publicIpv4: "203.0.113.10",
}
```

- [ ] **Step 2: Write Tailscale client tests**

Mock `fetch` and verify:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://api.tailscale.com/api/v2/tailnet/example.com/keys",
  expect.objectContaining({ method: "POST" }),
);
```

Assert auth-key response returns the key string and device lookup returns `100.64.1.20`.

- [ ] **Step 3: Run failing client tests**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/hetzner-client.test.ts lib/runtime/provisioner/__tests__/tailscale-client.test.ts
```

Expected: fail because clients do not exist.

- [ ] **Step 4: Implement Hetzner client**

Create `lib/runtime/provisioner/hetzner-client.ts` with:

```ts
export interface HetznerClient {
  createServer(args: {
    name: string;
    serverType: string;
    image: string;
    location: string;
    userData: string;
    labels: Record<string, string>;
  }): Promise<{ id: string; name: string; publicIpv4: string | null }>;
  deleteServer(serverId: string): Promise<void>;
}

export function createHetznerClient(apiToken: string, fetchImpl: typeof fetch = fetch): HetznerClient {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchImpl(`https://api.hetzner.cloud/v1${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Hetzner API request failed: ${res.status}`);
    return await res.json() as T;
  }

  return {
    async createServer(args) {
      const body = {
        name: args.name,
        server_type: args.serverType,
        image: args.image,
        location: args.location,
        user_data: args.userData,
        labels: args.labels,
      };
      const data = await request<{ server: { id: number; name: string; public_net?: { ipv4?: { ip?: string } } } }>(
        "/servers",
        { method: "POST", body: JSON.stringify(body) },
      );
      return {
        id: data.server.id.toString(),
        name: data.server.name,
        publicIpv4: data.server.public_net?.ipv4?.ip ?? null,
      };
    },
    async deleteServer(serverId) {
      const res = await fetchImpl(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`Hetzner API delete failed: ${res.status}`);
    },
  };
}
```

- [ ] **Step 5: Implement Tailscale client**

Create `lib/runtime/provisioner/tailscale-client.ts`:

```ts
export interface TailscaleClient {
  createAuthKey(args: { description: string; tags: string[]; reusable: boolean; expirySeconds: number }): Promise<string>;
  findDeviceIpByHostname(hostname: string): Promise<string | null>;
}

export function createTailscaleClient(args: {
  apiKey: string;
  tailnet: string;
  fetchImpl?: typeof fetch;
}): TailscaleClient {
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(args.tailnet)}`;
  const headers = {
    authorization: `Bearer ${args.apiKey}`,
    "content-type": "application/json",
  };

  return {
    async createAuthKey(input) {
      const res = await fetchImpl(`${baseUrl}/keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          capabilities: { devices: { create: { reusable: input.reusable, ephemeral: false, tags: input.tags } } },
          expirySeconds: input.expirySeconds,
          description: input.description,
        }),
      });
      if (!res.ok) throw new Error(`Tailscale auth-key request failed: ${res.status}`);
      const data = await res.json() as { key: string };
      return data.key;
    },
    async findDeviceIpByHostname(hostname) {
      const res = await fetchImpl(`${baseUrl}/devices`, { headers });
      if (!res.ok) throw new Error(`Tailscale devices request failed: ${res.status}`);
      const data = await res.json() as { devices?: Array<{ hostname?: string; addresses?: string[] }> };
      const device = (data.devices ?? []).find((item) => item.hostname === hostname);
      return device?.addresses?.find((address) => address.startsWith("100.")) ?? null;
    },
  };
}
```

- [ ] **Step 6: Run passing client tests**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/hetzner-client.test.ts lib/runtime/provisioner/__tests__/tailscale-client.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/runtime/provisioner/hetzner-client.ts lib/runtime/provisioner/tailscale-client.ts lib/runtime/provisioner/__tests__
git commit -m "feat: add Hetzner and Tailscale clients for T-20260505-014"
```

---

## Task 8: Add Worker cloud-init Rendering

**Files:**
- Create: `lib/runtime/provisioner/cloud-init.ts`
- Create: `lib/runtime/provisioner/__tests__/cloud-init.test.ts`

- [ ] **Step 1: Write cloud-init tests**

Assert cloud-init includes Docker, Tailscale, worker-agent image, worker ID, and redacted snapshot behavior:

```ts
expect(rendered).toContain("tailscale up --auth-key tskey-auth");
expect(rendered).toContain("ghcr.io/acme/worker-agent:sha");
expect(rendered).toContain("WORKER_ID=worker_123");
expect(redactCloudInit(rendered)).not.toContain("tskey-auth");
expect(redactCloudInit(rendered)).not.toContain("hmac-secret");
```

- [ ] **Step 2: Run failing cloud-init test**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/cloud-init.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement cloud-init renderer**

Create `lib/runtime/provisioner/cloud-init.ts`:

```ts
export interface RenderWorkerCloudInitArgs {
  workerId: string;
  workerAgentImage: string;
  workerAgentHmacSecret: string;
  tailscaleAuthKey: string;
  heartbeatUrl: string;
  sandboxImage: string;
}

export function renderWorkerCloudInit(args: RenderWorkerCloudInitArgs): string {
  return `#cloud-config
package_update: true
packages:
  - docker.io
  - tailscale
runcmd:
  - systemctl enable --now docker
  - systemctl enable --now tailscaled
  - tailscale up --auth-key ${shell(args.tailscaleAuthKey)} --hostname wbd-${shell(args.workerId)}
  - docker pull ${shell(args.workerAgentImage)}
  - docker pull ${shell(args.sandboxImage)}
  - docker run -d --restart unless-stopped --name worker-agent -p 4500:4500 -v /var/run/docker.sock:/var/run/docker.sock -e WORKER_ID=${shell(args.workerId)} -e WORKER_AGENT_HMAC_SECRET=${shell(args.workerAgentHmacSecret)} -e HEARTBEAT_URL=${shell(args.heartbeatUrl)} -e SANDBOX_IMAGE=${shell(args.sandboxImage)} ${shell(args.workerAgentImage)}
`;
}

export function redactCloudInit(value: string): string {
  return value
    .replace(/tskey-[A-Za-z0-9_-]+/g, "tskey-redacted")
    .replace(/WORKER_AGENT_HMAC_SECRET=([^ ]+)/g, "WORKER_AGENT_HMAC_SECRET=redacted");
}

function shell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
```

- [ ] **Step 4: Run passing cloud-init test**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/cloud-init.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/runtime/provisioner/cloud-init.ts lib/runtime/provisioner/__tests__/cloud-init.test.ts
git commit -m "feat: render worker cloud-init for T-20260505-014"
```

---

## Task 9: Implement `HetznerProvisioner`

**Files:**
- Create: `lib/runtime/provisioner/hetzner.ts`
- Create: `lib/runtime/provisioner/__tests__/hetzner.test.ts`
- Modify: `lib/runtime/types.ts`

- [ ] **Step 1: Extend runtime types**

In `lib/runtime/types.ts`, add optional fields to `WorkerRecord`:

```ts
  name?: string;
  serverType?: string | null;
  provisioningError?: string | null;
  readyAt?: Date | null;
```

Extend `ProvisionArgs`:

```ts
  name?: string;
```

- [ ] **Step 2: Write provisioner tests**

Mock Hetzner and Tailscale clients. Test:

```ts
expect(worker.provider).toBe("hetzner");
expect(worker.providerVmId).toBe("123");
expect(worker.capacity).toBe(10);
expect(worker.status).toBe("PROVISIONING");
```

Test `destroy()` calls Hetzner delete and marks DB row `DECOMMISSIONED`.

- [ ] **Step 3: Run failing provisioner tests**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/hetzner.test.ts
```

Expected: fail because provisioner does not exist.

- [ ] **Step 4: Implement provisioner**

Create `lib/runtime/provisioner/hetzner.ts` with a factory:

```ts
export function createHetznerProvisioner(args: {
  hetzner: HetznerClient;
  tailscale: TailscaleClient;
  workerAgentImage: string;
  workerAgentHmacSecret: string;
  sandboxImage: string;
  heartbeatBaseUrl: string;
  tailscaleWorkerTag: string;
}): WorkerProvisioner {
  return {
    providerId: "hetzner",
    async provision(input) {
      const row = await prisma.worker.create({
        data: {
          name: input.name ?? `worker-${Date.now()}`,
          tailscaleHostname: `wbd-${Date.now()}`,
          tailscaleIp: "",
          provider: "hetzner",
          providerVmId: "pending",
          region: input.region,
          serverType: input.size,
          capacity: input.capacity,
          status: "PROVISIONING",
        },
      });
      const authKey = await args.tailscale.createAuthKey({
        description: `Website Builder worker ${row.id}`,
        tags: [args.tailscaleWorkerTag],
        reusable: false,
        expirySeconds: 3600,
      });
      const userData = renderWorkerCloudInit({
        workerId: row.id,
        workerAgentImage: args.workerAgentImage,
        workerAgentHmacSecret: args.workerAgentHmacSecret,
        tailscaleAuthKey: authKey,
        heartbeatUrl: `${args.heartbeatBaseUrl}/api/internal/workers/${row.id}/heartbeat`,
        sandboxImage: args.sandboxImage,
      });
      const server = await args.hetzner.createServer({
        name: row.name,
        serverType: input.size,
        image: "ubuntu-24.04",
        location: input.region,
        userData,
        labels: { app: "website-builder-daytona", workerId: row.id },
      });
      const updated = await prisma.worker.update({
        where: { id: row.id },
        data: { providerVmId: server.id },
      });
      return rowToWorkerRecord(updated);
    },
    async destroy(workerId) {
      const worker = await prisma.worker.findUnique({ where: { id: workerId } });
      if (!worker || worker.provider !== "hetzner") return;
      if (worker.providerVmId !== "pending") await args.hetzner.deleteServer(worker.providerVmId);
      await prisma.worker.update({
        where: { id: workerId },
        data: { status: "DECOMMISSIONED", decommissionedAt: new Date() },
      });
    },
    async listOwned() {
      const rows = await prisma.worker.findMany({
        where: { provider: "hetzner", status: { not: "DECOMMISSIONED" } },
      });
      return rows.map(rowToWorkerRecord);
    },
  };
}
```

Use the existing `rowToRecord` pattern from `lib/runtime/provisioner/fake.ts`; keep helper local or extract shared helper only if duplication becomes distracting.

Also export an env-backed helper for admin routes:

```ts
export function createHetznerWorkerProvisionerFromEnv(runtimeEnv: Record<string, string> = process.env): WorkerProvisioner {
  return createHetznerProvisioner({
    hetzner: createHetznerClient(requiredEnv("HETZNER_API_TOKEN", runtimeEnv)),
    tailscale: createTailscaleClient({
      apiKey: requiredEnv("TAILSCALE_API_KEY", runtimeEnv),
      tailnet: requiredEnv("TAILSCALE_TAILNET", runtimeEnv),
    }),
    workerAgentImage: requiredEnv("WORKER_AGENT_IMAGE", runtimeEnv),
    workerAgentHmacSecret: requiredEnv("WORKER_AGENT_HMAC_SECRET", runtimeEnv),
    sandboxImage: requiredEnv("SANDBOX_IMAGE", runtimeEnv),
    heartbeatBaseUrl: requiredEnv("APP_BASE_URL", runtimeEnv),
    tailscaleWorkerTag: requiredEnv("TAILSCALE_WORKER_TAG", runtimeEnv),
  });
}
```

Implement `requiredEnv()` in the same file:

```ts
function requiredEnv(name: string, runtimeEnv: Record<string, string | undefined>): string {
  const value = runtimeEnv[name];
  if (!value) throw new Error(`Hetzner provisioner requires env: ${name}`);
  return value;
}
```

- [ ] **Step 5: Run passing provisioner tests**

Run:

```bash
pnpm test:host -- lib/runtime/provisioner/__tests__/hetzner.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/runtime/types.ts lib/runtime/provisioner/hetzner.ts lib/runtime/provisioner/__tests__/hetzner.test.ts
git commit -m "feat: add Hetzner provisioner for T-20260505-014"
```

---

## Task 10: Wire `worker-pool-hetzner` Runtime Mode

**Files:**
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Modify: `lib/runtime/worker-pool/index.ts`
- Modify: `lib/runtime/index.ts`
- Modify: `lib/runtime/worker-pool/__tests__/runtime.test.ts`
- Modify: `lib/runtime/worker-pool/__tests__/index.test.ts`
- Modify: `lib/runtime/__tests__/index.test.ts`

- [ ] **Step 1: Add runtime tests**

In runtime tests, add a test where scheduler returns null and provisioner provider is `hetzner`; expect `NO_WORKER_CAPACITY`.

In index tests, assert:

```ts
process.env.RUNTIME_MODE = "worker-pool-hetzner";
expect(() => createRuntime()).not.toThrow();
```

Mock required env vars in the test:

```ts
process.env.SANDBOX_IMAGE = "wbd/sandbox:test";
process.env.WORKER_AGENT_IMAGE = "wbd/worker-agent:test";
process.env.WORKER_AGENT_HMAC_SECRET = "secret";
process.env.HETZNER_API_TOKEN = "hcloud";
process.env.TAILSCALE_API_KEY = "ts";
process.env.TAILSCALE_TAILNET = "example.com";
process.env.TAILSCALE_WORKER_TAG = "tag:website-builder-worker";
process.env.HETZNER_DEFAULT_REGION = "fsn1";
process.env.HETZNER_DEFAULT_SERVER_TYPE = "ccx33";
```

- [ ] **Step 2: Run failing runtime tests**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/worker-pool/__tests__/index.test.ts lib/runtime/__tests__/index.test.ts
```

Expected: fail until mode is wired.

- [ ] **Step 3: Update `ensureWorker` semantics**

In `lib/runtime/worker-pool/runtime.ts`, add an option:

```ts
autoProvisionWhenFull?: boolean;
```

For local mode, pass `true`. For Hetzner managed mode, pass `false`.

When `scheduler.pickWorker()` returns null and `autoProvisionWhenFull` is false:

```ts
throw new RuntimeError("NO_WORKER_CAPACITY", "No ready worker has a free project slot");
```

- [ ] **Step 4: Create Hetzner runtime factory**

In `lib/runtime/worker-pool/index.ts`, export:

```ts
export function createHetznerWorkerPoolRuntime(): Runtime {
  const runtimeEnv = collectRuntimeEnv();
  const sandboxImage = required("SANDBOX_IMAGE", runtimeEnv);
  const hmacSecret = required("WORKER_AGENT_HMAC_SECRET", runtimeEnv);
  const workerAgentImage = required("WORKER_AGENT_IMAGE", runtimeEnv);
  const scheduler = createSimpleScheduler();
  const provisioner = createHetznerProvisioner({
    hetzner: createHetznerClient(required("HETZNER_API_TOKEN", runtimeEnv)),
    tailscale: createTailscaleClient({
      apiKey: required("TAILSCALE_API_KEY", runtimeEnv),
      tailnet: required("TAILSCALE_TAILNET", runtimeEnv),
    }),
    workerAgentImage,
    workerAgentHmacSecret: hmacSecret,
    sandboxImage,
    heartbeatBaseUrl: required("APP_BASE_URL", runtimeEnv),
    tailscaleWorkerTag: required("TAILSCALE_WORKER_TAG", runtimeEnv),
  });
  return createWorkerPoolRuntime({
    scheduler,
    provisioner,
    agentClientFor: (worker) => createAgentClient(resolveWorkerAgentClientConfig({ worker, hmacSecret, runtimeEnv })),
    sandboxImage,
    brokerEnv: () => collectBrokerEnv(collectRuntimeEnv()),
    autoProvisionWhenFull: false,
    defaultRegion: runtimeEnv.HETZNER_DEFAULT_REGION ?? "fsn1",
    defaultCapacity: optionalPositiveInt("WORKER_DEFAULT_CAPACITY", runtimeEnv) ?? 10,
  });
}
```

If `APP_BASE_URL` is not already available in this repo, add it as a required server-only env for live worker heartbeat callback URLs.

- [ ] **Step 5: Wire runtime factory**

In `lib/runtime/index.ts`:

```ts
import { createHetznerWorkerPoolRuntime, createLocalWorkerPoolRuntime } from "./worker-pool";
```

And:

```ts
if (mode === "worker-pool-hetzner") {
  return createHetznerWorkerPoolRuntime();
}
```

- [ ] **Step 6: Run passing runtime tests**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/runtime.test.ts lib/runtime/worker-pool/__tests__/index.test.ts lib/runtime/__tests__/index.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add lib/runtime
git commit -m "feat: wire Hetzner worker pool runtime for T-20260505-014"
```

---

## Task 11: Add Worker Admin Service

**Files:**
- Create: `lib/admin/workers.ts`
- Create: `lib/admin/__tests__/workers.test.ts`

- [ ] **Step 1: Write service tests**

Test serialization returns slot counts:

```ts
expect(serialized.slotsUsed).toBe(2);
expect(serialized.slotsCapacity).toBe(10);
expect(serialized.slotsFree).toBe(8);
```

Test validation rejects invalid capacity:

```ts
expect(() => parseCreateWorkerInput({ name: "", region: "fsn1", serverType: "ccx33", capacity: 0 })).toThrow("name is required");
```

- [ ] **Step 2: Run failing admin service tests**

Run:

```bash
pnpm test:host -- lib/admin/__tests__/workers.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 3: Implement admin service**

Create `lib/admin/workers.ts`:

```ts
import { prisma } from "@/lib/db/client";

const SLOT_STATUSES = ["SPAWNING", "RUNNING", "STOPPED"] as const;

export interface CreateWorkerInput {
  name: string;
  region: string;
  serverType: string;
  capacity: number;
}

export function parseCreateWorkerInput(body: Record<string, unknown>): CreateWorkerInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const region = typeof body.region === "string" ? body.region.trim() : "";
  const serverType = typeof body.serverType === "string" ? body.serverType.trim() : "";
  const capacity = typeof body.capacity === "number" ? body.capacity : Number.parseInt(String(body.capacity ?? ""), 10);
  if (!name) throw new Error("name is required");
  if (!region) throw new Error("region is required");
  if (!serverType) throw new Error("serverType is required");
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("capacity must be a positive integer");
  return { name, region, serverType, capacity };
}

export async function listWorkersForAdmin() {
  const workers = await prisma.worker.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          sandboxes: { where: { status: { in: [...SLOT_STATUSES] } } },
        },
      },
    },
  });
  return workers.map((worker) => {
    const slotsUsed = worker._count.sandboxes;
    return {
      id: worker.id,
      name: worker.name,
      status: worker.status,
      provider: worker.provider,
      providerVmId: worker.providerVmId,
      region: worker.region,
      serverType: worker.serverType,
      tailscaleHostname: worker.tailscaleHostname,
      tailscaleIp: worker.tailscaleIp,
      lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null,
      createdAt: worker.createdAt.toISOString(),
      provisioningError: worker.provisioningError,
      slotsUsed,
      slotsCapacity: worker.capacity,
      slotsFree: Math.max(0, worker.capacity - slotsUsed),
    };
  });
}
```

- [ ] **Step 4: Run passing admin service tests**

Run:

```bash
pnpm test:host -- lib/admin/__tests__/workers.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/workers.ts lib/admin/__tests__/workers.test.ts
git commit -m "feat: add worker admin service for T-20260505-014"
```

---

## Task 12: Add Worker Admin API Routes

**Files:**
- Create: `app/api/admin/workers/route.ts`
- Create: `app/api/admin/workers/[id]/route.ts`
- Create: `app/api/admin/workers/[id]/drain/route.ts`
- Create: `app/api/admin/workers/[id]/retry/route.ts`
- Create tests under `app/api/admin/workers/**/__tests__`

- [ ] **Step 1: Write route tests**

Test:

- `GET /api/admin/workers` returns workers and slot counts.
- `POST /api/admin/workers` validates inputs.
- `POST /api/admin/workers/[id]/drain` changes status to `DRAINING`.
- `DELETE /api/admin/workers/[id]` refuses workers with active sandboxes.
- `DELETE /api/admin/workers/[id]` marks empty worker `DECOMMISSIONED`.

- [ ] **Step 2: Run failing route tests**

Run:

```bash
pnpm test:host -- app/api/admin/workers
```

Expected: fail because routes do not exist.

- [ ] **Step 3: Implement list/create route**

Create `app/api/admin/workers/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { listWorkersForAdmin, parseCreateWorkerInput } from "@/lib/admin/workers";
import { createHetznerWorkerProvisionerFromEnv } from "@/lib/runtime/provisioner/hetzner";

export async function GET() {
  return NextResponse.json({ workers: await listWorkersForAdmin() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  let input;
  try {
    input = parseCreateWorkerInput(body as Record<string, unknown>);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid worker" }, { status: 400 });
  }
  const provisioner = createHetznerWorkerProvisionerFromEnv();
  const worker = await provisioner.provision({
    name: input.name,
    region: input.region,
    size: input.serverType,
    capacity: input.capacity,
  });
  return NextResponse.json({ worker }, { status: 201 });
}
```

- [ ] **Step 4: Implement drain/delete/retry**

Use direct DB updates plus `HetznerProvisioner.destroy()` for delete:

```ts
await prisma.worker.update({
  where: { id },
  data: { status: "DRAINING" },
});
```

For decommission, first count active sandboxes:

```ts
const activeCount = await prisma.workerSandbox.count({
  where: { workerId: id, status: { in: ["SPAWNING", "RUNNING", "STOPPED"] } },
});
if (activeCount > 0) {
  return NextResponse.json({ error: "worker has active sandboxes" }, { status: 409 });
}
```

- [ ] **Step 5: Run passing route tests**

Run:

```bash
pnpm test:host -- app/api/admin/workers
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/workers lib/admin lib/runtime/provisioner/hetzner.ts
git commit -m "feat: add worker admin APIs for T-20260505-014"
```

---

## Task 13: Add Worker Admin UI

**Files:**
- Create: `app/admin/workers/page.tsx`
- Create: `app/admin/workers/WorkersClient.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add server page shell**

Create `app/admin/workers/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import WorkersClient from "./WorkersClient";

export default function WorkersPage(): React.ReactElement {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 w-fit">
              <Link href="/">
                <ArrowLeft />
                Projects
              </Link>
            </Button>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Workers
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Manage Hetzner servers and project slots for the worker pool.
            </p>
          </div>
        </header>
        <WorkersClient />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add client component**

Create `app/admin/workers/WorkersClient.tsx` with:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Worker = {
  id: string;
  name: string;
  status: "PROVISIONING" | "READY" | "DRAINING" | "DECOMMISSIONED" | "OFFLINE";
  provider: string;
  providerVmId: string;
  region: string;
  serverType: string | null;
  tailscaleIp: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
  provisioningError: string | null;
  slotsUsed: number;
  slotsCapacity: number;
  slotsFree: number;
};

export default function WorkersClient(): React.ReactElement {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", region: "fsn1", serverType: "ccx33", capacity: "10" });
  const [pending, startTransition] = useTransition();

  async function refresh(): Promise<void> {
    const res = await fetch("/api/admin/workers", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { workers: Worker[] };
    setWorkers(data.workers);
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : "failed to load workers"));
  }, []);

  function createWorker(): void {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/workers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, capacity: Number.parseInt(form.capacity, 10) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "failed to create worker");
        return;
      }
      setForm((current) => ({ ...current, name: "" }));
      await refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create worker</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[1fr_120px_160px_120px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              createWorker();
            }}
          >
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="worker-fsn1-a" />
            <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            <Input value={form.serverType} onChange={(e) => setForm({ ...form, serverType: e.target.value })} />
            <Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} inputMode="numeric" />
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Worker pool</h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => void refresh()} aria-label="Refresh workers">
            <RefreshCw />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Slots</th>
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Tailscale</th>
                <th className="px-4 py-2 font-medium">Heartbeat</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(workers ?? []).map((worker) => (
                <tr key={worker.id}>
                  <td className="px-4 py-3 font-medium">{worker.name}</td>
                  <td className="px-4 py-3"><Badge variant={worker.status === "READY" ? "success" : worker.status === "OFFLINE" ? "destructive" : "secondary"}>{worker.status.toLowerCase()}</Badge></td>
                  <td className="px-4 py-3 tabular-nums">{worker.slotsUsed} / {worker.slotsCapacity}</td>
                  <td className="px-4 py-3">{worker.region}</td>
                  <td className="px-4 py-3">{worker.serverType ?? "unknown"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{worker.tailscaleIp || "pending"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{worker.lastHeartbeatAt ?? "never"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Decommission ${worker.name}`}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

Then wire drain/retry/delete handlers into this component after the API routes pass. Reuse the existing `confirm()` pattern from `app/page.tsx` for destructive actions.

- [ ] **Step 3: Add dashboard nav link**

In `app/page.tsx`, import `Server` from `lucide-react` and add:

```tsx
<Button asChild variant="outline" size="sm">
  <Link href="/admin/workers">
    <Server />
    Workers
  </Link>
</Button>
```

- [ ] **Step 4: Run lint for UI**

Run:

```bash
pnpm lint -- app/admin/workers app/page.tsx
```

Expected: no lint errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/workers app/page.tsx
git commit -m "feat: add worker admin UI for T-20260505-014"
```

---

## Task 14: Add Caddy Route Config Builder

**Files:**
- Create: `lib/routing/caddy-config.ts`
- Create: `lib/routing/__tests__/caddy-config.test.ts`

- [ ] **Step 1: Write Caddy config tests**

Assert:

```ts
expect(route.match).toEqual([{ host: ["project-a.example.com"] }]);
expect(JSON.stringify(route)).toContain("100.64.1.20:3001");
```

- [ ] **Step 2: Run failing config tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/caddy-config.test.ts
```

Expected: fail because builder does not exist.

- [ ] **Step 3: Implement route builder**

Create `lib/routing/caddy-config.ts`:

```ts
export interface ProjectPreviewRouteArgs {
  hostname: string;
  targetHost: string;
  targetPort: number;
}

export function buildProjectPreviewRoute(args: ProjectPreviewRouteArgs): object {
  return {
    match: [{ host: [args.hostname] }],
    handle: [{
      handler: "reverse_proxy",
      upstreams: [{ dial: `${args.targetHost}:${args.targetPort}` }],
    }],
  };
}
```

- [ ] **Step 4: Run passing config tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/caddy-config.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/routing/caddy-config.ts lib/routing/__tests__/caddy-config.test.ts
git commit -m "feat: build Caddy project routes for T-20260505-014"
```

---

## Task 15: Add Caddy Admin Client

**Files:**
- Create: `lib/routing/caddy-client.ts`
- Create: `lib/routing/__tests__/caddy-client.test.ts`

- [ ] **Step 1: Write Caddy client tests**

Mock `fetch` and assert route apply sends JSON to configured admin URL:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "http://127.0.0.1:2019/config/apps/http/servers/srv0/routes/project-a",
  expect.objectContaining({ method: "PUT" }),
);
```

- [ ] **Step 2: Run failing client tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/caddy-client.test.ts
```

Expected: fail because client does not exist.

- [ ] **Step 3: Implement Caddy client**

Create `lib/routing/caddy-client.ts`:

```ts
export interface CaddyClient {
  applyRoute(routeId: string, route: object): Promise<void>;
  deleteRoute(routeId: string): Promise<void>;
}

export function createCaddyClient(adminUrl: string, fetchImpl: typeof fetch = fetch): CaddyClient {
  const base = adminUrl.replace(/\/+$/, "");
  return {
    async applyRoute(routeId, route) {
      const res = await fetchImpl(`${base}/config/apps/http/servers/srv0/routes/${encodeURIComponent(routeId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(route),
      });
      if (!res.ok) throw new Error(`Caddy route apply failed: ${res.status}`);
    },
    async deleteRoute(routeId) {
      const res = await fetchImpl(`${base}/config/apps/http/servers/srv0/routes/${encodeURIComponent(routeId)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) throw new Error(`Caddy route delete failed: ${res.status}`);
    },
  };
}
```

- [ ] **Step 4: Run passing client tests**

Run:

```bash
pnpm test:host -- lib/routing/__tests__/caddy-client.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/routing/caddy-client.ts lib/routing/__tests__/caddy-client.test.ts
git commit -m "feat: add Caddy admin client for T-20260505-014"
```

---

## Task 16: Apply Public Routes After Sandbox Placement

**Files:**
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/restart/route.ts`
- Modify: `lib/runtime/worker-pool/__tests__/runtime.test.ts`

- [ ] **Step 1: Add route hook test**

In `lib/runtime/worker-pool/__tests__/runtime.test.ts`, add a runtime arg:

```ts
const appliedRoutes: Array<{ projectId: string; sandboxId: string; previewUrl: string }> = [];
```

Pass:

```ts
projectRouteFor: async ({ projectId, sandboxId, worker, previewPort }) => {
  const previewUrl = `https://${projectId}.example.com`;
  appliedRoutes.push({ projectId, sandboxId, previewUrl });
  return { previewUrl };
},
```

Assert `spawnProjectSandbox()` returns the public preview URL.

- [ ] **Step 2: Run failing route hook test**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/runtime.test.ts
```

Expected: fails until hook exists.

- [ ] **Step 3: Add optional route hook to runtime args**

In `CreateWorkerPoolRuntimeArgs`:

```ts
projectRouteFor?: (args: {
  projectId: string;
  sandboxId: string;
  worker: WorkerRecord;
  previewPort: number;
}) => Promise<{ previewUrl: string }>;
```

After agent sandbox creation and before returning `SandboxInfo`:

```ts
const routed = await args.projectRouteFor?.({
  projectId: spawn.projectId,
  sandboxId,
  worker,
  previewPort: created.previewPort,
});
```

Return:

```ts
previewUrl: routed?.previewUrl ?? `http://${publicHost}:${created.previewPort}`,
```

- [ ] **Step 4: Wire H.1d route hook in Hetzner factory only**

In `createHetznerWorkerPoolRuntime`, if `PUBLIC_BASE_DOMAIN` and `CADDY_ADMIN_URL` are present, apply route:

```ts
projectRouteFor: async ({ projectId, worker, previewPort }) => {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { publicSlug: true },
  });
  if (!project.publicSlug) return { previewUrl: `http://${worker.tailscaleIp}:${previewPort}` };
  const hostname = `${project.publicSlug}.${runtimeEnv.PUBLIC_BASE_DOMAIN}`;
  await createCaddyClient(runtimeEnv.CADDY_ADMIN_URL).applyRoute(
    project.publicSlug,
    buildProjectPreviewRoute({ hostname, targetHost: worker.tailscaleIp, targetPort: previewPort }),
  );
  return { previewUrl: `https://${hostname}` };
},
```

Do not require H.1d env vars for H.1c.

- [ ] **Step 5: Run route hook tests**

Run:

```bash
pnpm test:host -- lib/runtime/worker-pool/__tests__/runtime.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add lib/runtime/worker-pool lib/routing
git commit -m "feat: route project previews through Caddy for T-20260505-014"
```

---

## Task 17: Improve Capacity Error Handling In Project APIs

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/restart/route.ts`
- Modify: `app/api/projects/__tests__/route.test.ts`
- Modify: `app/api/projects/[id]/restart/__tests__/route.test.ts`

- [ ] **Step 1: Add API tests for capacity errors**

Mock `spawnProjectSandbox` to reject:

```ts
throw new RuntimeError("NO_WORKER_CAPACITY", "No ready worker has a free project slot");
```

Assert response:

```ts
expect(response.status).toBe(409);
expect(body.message).toBe("No ready worker has a free project slot");
```

- [ ] **Step 2: Run failing API tests**

Run:

```bash
pnpm test:host -- app/api/projects/__tests__/route.test.ts app/api/projects/[id]/restart/__tests__/route.test.ts
```

Expected: fail until API maps runtime error to 409.

- [ ] **Step 3: Update safe error mapping**

Import:

```ts
import { isRuntimeError } from "@/lib/runtime/errors";
```

In create and restart catch blocks:

```ts
if (isRuntimeError(error, "NO_WORKER_CAPACITY")) {
  return NextResponse.json(
    { error: "no worker capacity", message: error.message },
    { status: 409 },
  );
}
```

For project creation after the DB row exists, also update project status:

```ts
status: "DESTROYED",
provisioningError: error.message,
```

- [ ] **Step 4: Run passing API tests**

Run:

```bash
pnpm test:host -- app/api/projects/__tests__/route.test.ts app/api/projects/[id]/restart/__tests__/route.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/projects lib/runtime/errors.ts
git commit -m "fix: surface worker capacity errors for T-20260505-014"
```

---

## Task 18: Live Manual Validation Script

**Files:**
- Create: `scripts/validate-hetzner-worker-pool.md`
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md` if runtime env docs need updating.

- [ ] **Step 1: Create live validation checklist**

Create `scripts/validate-hetzner-worker-pool.md`:

```markdown
# Hetzner Worker Pool Live Validation

## Required env

- RUNTIME_MODE=worker-pool-hetzner
- APP_BASE_URL
- SANDBOX_IMAGE
- WORKER_AGENT_IMAGE
- WORKER_AGENT_HMAC_SECRET
- HETZNER_API_TOKEN
- TAILSCALE_API_KEY
- TAILSCALE_TAILNET
- TAILSCALE_WORKER_TAG
- HETZNER_DEFAULT_REGION
- HETZNER_DEFAULT_SERVER_TYPE
- WORKER_DEFAULT_CAPACITY

## H.1c validation

1. Start the app with `pnpm dev`.
2. Open `/admin/workers`.
3. Create a worker with capacity `1`.
4. Wait until status is `READY`.
5. Create project A.
6. Confirm project A runs on worker 1.
7. Create project B.
8. Confirm project B fails with no capacity.
9. Create worker 2 with capacity `1`.
10. Restart project A.
11. Confirm project A may move to worker 2.

## H.1d validation

1. Set `PUBLIC_BASE_DOMAIN`, `CADDY_ADMIN_URL`, and `CLOUDFLARE_API_TOKEN`.
2. Start Caddy with Cloudflare DNS support.
3. Restart project A.
4. Confirm preview URL is `https://<slug>.<domain>`.
5. Confirm the same URL still works after moving the project to another worker.
```

- [ ] **Step 2: Update runtime docs**

In `docs/AGENT_RUNTIME_OPTIONS.md`, add a short `worker-pool-hetzner` section listing the env vars and noting Cloudflare/Caddy env vars are only needed for public routing.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-hetzner-worker-pool.md docs/AGENT_RUNTIME_OPTIONS.md
git commit -m "docs: add Hetzner worker pool validation for T-20260505-014"
```

---

## Task 19: Full Verification

**Files:**
- All files touched by prior tasks.

- [ ] **Step 1: Run focused host tests**

Run:

```bash
pnpm test:host -- lib/runtime lib/admin lib/routing app/api/admin/workers app/api/projects
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: all package tests pass. If the known Docker port race appears, rerun once and record the transient failure in the task file.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: no new lint errors. Existing warnings from the H.1b handover may remain only if still present.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: build exits 0. Existing Turbopack NFT warning may remain only if unchanged from the H.1b handover.

- [ ] **Step 5: Manual validation**

Follow:

```bash
sed -n '1,220p' scripts/validate-hetzner-worker-pool.md
```

Expected: H.1c live worker flow validates before H.1d public routing is enabled.

- [ ] **Step 6: Complete task docs**

Update `docs/tasks/active/T-20260505-014.md` outcome with verification results if this plan is implemented under the same task. If implementation uses a new task ID, close this planning task and create a new implementation task before code changes.

- [ ] **Step 7: Final commit**

```bash
git status --short
git add docs/tasks docs/changelog docs/superpowers/plans docs/superpowers/specs scripts docs/AGENT_RUNTIME_OPTIONS.md
git commit -m "docs: record managed worker pool verification for T-20260505-014"
```

Expected: working tree only contains unrelated user changes, if any.

---

## Self-Review Notes

- Spec coverage: covers admin worker creation, project capacity slots, elastic restart placement, Hetzner live provisioning, Tailscale private connectivity, Cloudflare wildcard TLS, and public project subdomains.
- Scope boundary: H.1c can ship without Caddy env vars; H.1d layers public routing after worker scheduling is stable.
- Type consistency: uses `sandboxId`, `publicSlug`, `Worker.capacity`, and slot-consuming sandbox statuses consistently.
- Implementation caution: Admin worker APIs use `createHetznerWorkerProvisionerFromEnv()` directly so the generic `Runtime` interface stays provider-agnostic.
