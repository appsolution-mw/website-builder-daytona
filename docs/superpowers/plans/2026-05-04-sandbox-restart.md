# Sandbox Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-facing sandbox restart action that recreates the current project sandbox.

**Architecture:** Implement a focused `POST /api/projects/[id]/restart` Route Handler that owns lifecycle orchestration and returns the updated project. Reuse existing runtime factories, GitHub installation token creation, and project environment persistence.

**Tech Stack:** Next.js 16 App Router Route Handlers, Prisma, Vitest, React client components, lucide-react.

---

### Task 1: Restart Route

**Files:**
- Create: `app/api/projects/[id]/restart/route.ts`
- Test: `app/api/projects/[id]/restart/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Test `POST` with a running template project, saved env content, and an old sandbox id. Assert it calls `destroyProjectSandbox("sandbox-old")`, then `spawnProjectSandbox({ projectId, source: { type: "template" }, projectEnvContent })`, updates the project to `RUNNING`, and returns HTTP 200.

- [ ] **Step 2: Run the focused test to verify red**

Run: `pnpm vitest run --config vitest.config.ts app/api/projects/[id]/restart/__tests__/route.test.ts`

Expected: fail because the route file does not exist yet.

- [ ] **Step 3: Implement minimal route**

Create a route handler that requires ownership, rejects `PROVISIONING`, loads `ProjectEnvironment`, destroys the old sandbox, spawns a new one, stores new URLs/tokens, and returns `{ project }`.

- [ ] **Step 4: Run the focused test to verify green**

Run: `pnpm vitest run --config vitest.config.ts app/api/projects/[id]/restart/__tests__/route.test.ts`

Expected: pass.

### Task 2: Workspace Action

**Files:**
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Add restart UI state and handler**

Add `sandboxRestarting` and `sandboxRestartError` state. The handler posts to `/api/projects/${id}/restart`, stores the returned project, clears websocket readiness for the old connection, and increments `previewReloadKey`.

- [ ] **Step 2: Add the header button**

Use a compact button with `RefreshCw`/`Loader2`, accessible label `Restart sandbox`, and disable it while an agent turn or restart is active.

- [ ] **Step 3: Verify host checks**

Run: `pnpm vitest run --config vitest.config.ts app/api/projects/[id]/restart/__tests__/route.test.ts`

Expected: pass.

Run: `pnpm lint`

Expected: no new lint errors from the changed files.

### Self-Review

- Spec coverage: route, auth, lifecycle, env propagation, UI action, and focused tests are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: route context uses `params: Promise<{ id: string }>` to match Next.js 16 docs already used by the project.
