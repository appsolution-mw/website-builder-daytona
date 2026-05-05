# Durable Project Agent Queue Implementation Plan

Status: Implemented under `T-20260505-010`. This file is retained as the
original execution artifact; unchecked boxes and earlier task IDs in commit
examples are historical plan text, not current project status.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a durable project-level FIFO agent queue so customer project tasks keep running after browser disconnects, stream events are replayable, failed runs are retryable, and OpenHands conversations resume reliably.

**Architecture:** Move agent execution ownership from the browser WebSocket to server-side run records, a project queue state, and a sandbox/broker run executor. The browser creates queued runs through Host APIs and subscribes to persisted run events; the broker executes one project run at a time and writes every provider event before broadcasting.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Prisma 7/Postgres, existing worker-pool runtime, sandbox broker WebSocket/HTTP boundaries, OpenHands SDK, Vitest.

---

## File Structure

- Modify `prisma/schema.prisma`: add workspace tenancy, queue state, run, attempt, and event models plus enums.
- Create `prisma/migrations/20260505190000_add_durable_agent_queue/migration.sql`: schema migration.
- Create `lib/workspaces/access.ts`: workspace/project access helpers.
- Create `lib/agent-runs/types.ts`: shared host-side run types and serializers.
- Create `lib/agent-runs/events.ts`: event persistence and replay helpers.
- Create `lib/agent-runs/queue.ts`: enqueue, drain, block, retry, skip, and cancel state transitions.
- Create `lib/agent-runs/executor-client.ts`: host-to-worker/broker command client for drain/cancel operations.
- Create `app/api/projects/[id]/runs/route.ts`: enqueue/list runs.
- Create `app/api/projects/[id]/runs/[runId]/retry/route.ts`: retry failed run.
- Create `app/api/projects/[id]/runs/[runId]/skip/route.ts`: skip failed run.
- Create `app/api/projects/[id]/runs/[runId]/cancel/route.ts`: explicit cancel.
- Create `app/api/projects/[id]/events/route.ts`: event replay endpoint.
- Modify `packages/protocol/src/index.ts`: add run/event subscription protocol fields without removing current file/terminal messages.
- Modify `container/sandbox/broker/src/agent-provider.ts`: add run attempt metadata and provider resume state inputs.
- Create `container/sandbox/broker/src/agent-run-executor.ts`: durable provider execution boundary.
- Modify `container/sandbox/broker/src/ws-server.ts`: remove browser-owned turn lifecycle, keep subscriptions and live broadcast.
- Modify `container/sandbox/broker/src/ws-server.ts`: add internal broker command routes on the existing broker port.
- Modify `container/sandbox/broker/src/openhands-runner.ts`: pass OpenHands conversation persistence args to the Python bridge.
- Modify `container/sandbox/broker/python/openhands_bridge.py`: accept `--conversation-id` and `--persistence-dir`.
- Modify `app/project/[id]/page.tsx`: submit prompts via run API, hydrate runs/events, replay stream state, and show project queue status.
- Modify `components/chat/Message.tsx`: support queued, running, failed, and cancelled run presentation.
- Modify `docs/AGENT_RUNTIME_OPTIONS.md`: document durable queue and OpenHands persistence behavior.

---

## Task 1: Add Durable Queue Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260505190000_add_durable_agent_queue/migration.sql`
- Test: `lib/agent-runs/__tests__/schema-smoke.test.ts`

- [ ] **Step 1: Add Prisma models and enums**

Add these enums to `prisma/schema.prisma`:

```prisma
enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
}

enum AgentRunStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum AgentRunAttemptStatus {
  STARTING
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum AgentRunEventType {
  STATUS
  CHUNK
  TOOL_USE
  USAGE
  DONE
  ERROR
  FILE_CHANGED
}

enum ProjectQueueStatus {
  IDLE
  RUNNING
  BLOCKED
}
```

Add these relations:

```prisma
model Workspace {
  id        String            @id @default(cuid())
  name      String
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  members   WorkspaceMember[]
  projects  Project[]
}

model WorkspaceMember {
  id          String        @id @default(cuid())
  workspaceId String
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        WorkspaceRole @default(MEMBER)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@unique([workspaceId, userId])
  @@index([userId])
}
```

Extend `User`:

```prisma
workspaceMemberships WorkspaceMember[]
createdAgentRuns     AgentRun[]
```

Extend `Project`:

```prisma
workspaceId String?
workspace   Workspace? @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
queueState  ProjectQueueState?
agentRuns   AgentRun[]
runEvents   AgentRunEvent[]
```

Add these models:

```prisma
model ProjectQueueState {
  projectId    String             @id
  project      Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  state        ProjectQueueStatus @default(IDLE)
  activeRunId  String?
  blockedRunId String?
  blockedAt    DateTime?
  updatedAt    DateTime           @updatedAt
  createdAt    DateTime           @default(now())
}

model AgentRun {
  id                String         @id @default(cuid())
  projectId         String
  project           Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sessionId         String
  session           Session        @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userMessageId     String?
  userMessage       Message?       @relation("AgentRunUserMessage", fields: [userMessageId], references: [id], onDelete: SetNull)
  createdById       String
  createdBy         User           @relation(fields: [createdById], references: [id])
  status            AgentRunStatus @default(QUEUED)
  runtime           AgentRuntime
  providerSessionId String
  modelId           String?
  queueSequence     Int
  queuedAt          DateTime       @default(now())
  startedAt         DateTime?
  finishedAt        DateTime?
  blockedReason     String?
  lastAttemptNumber Int            @default(0)
  attempts          AgentRunAttempt[]
  events            AgentRunEvent[]

  @@unique([projectId, queueSequence])
  @@index([projectId, status, queueSequence])
  @@index([sessionId, queuedAt])
}

model AgentRunAttempt {
  id                     String                @id @default(cuid())
  runId                  String
  run                    AgentRun              @relation(fields: [runId], references: [id], onDelete: Cascade)
  attemptNumber          Int
  status                 AgentRunAttemptStatus @default(STARTING)
  startedAt              DateTime?
  finishedAt             DateTime?
  exitCode               Int?
  errorMessage           String?
  baseCommitSha          String?
  gitStatusBefore        String?               @db.Text
  gitDiffStatBefore      String?               @db.Text
  providerConversationId String?
  providerResumeState    Json?
  events                 AgentRunEvent[]

  @@unique([runId, attemptNumber])
  @@index([runId, status])
}

model AgentRunEvent {
  id        String            @id @default(cuid())
  runId     String
  run       AgentRun          @relation(fields: [runId], references: [id], onDelete: Cascade)
  attemptId String?
  attempt   AgentRunAttempt?  @relation(fields: [attemptId], references: [id], onDelete: SetNull)
  projectId String
  project   Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sessionId String
  session   Session           @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sequence  Int
  type      AgentRunEventType
  agentId   String?
  payload   Json
  createdAt DateTime          @default(now())

  @@unique([projectId, sequence])
  @@index([runId, sequence])
  @@index([sessionId, sequence])
}
```

Extend `Session`:

```prisma
agentRuns AgentRun[]
runEvents AgentRunEvent[]
```

Extend `Message`:

```prisma
agentRunUserFor AgentRun[] @relation("AgentRunUserMessage")
```

- [ ] **Step 2: Generate migration**

Run:

```bash
pnpm prisma migrate dev --name add_durable_agent_queue
```

Expected: Prisma creates a timestamped migration directory under
`prisma/migrations/` containing `migration.sql`. Keep Prisma's generated
timestamped directory name and use that actual path in the commit.

- [ ] **Step 3: Add schema smoke test**

Create `lib/agent-runs/__tests__/schema-smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";

describe("durable agent queue schema", () => {
  it("exposes durable queue delegates", () => {
    expect(prisma.workspace).toBeDefined();
    expect(prisma.workspaceMember).toBeDefined();
    expect(prisma.projectQueueState).toBeDefined();
    expect(prisma.agentRun).toBeDefined();
    expect(prisma.agentRunAttempt).toBeDefined();
    expect(prisma.agentRunEvent).toBeDefined();
  });
});
```

- [ ] **Step 4: Verify schema**

Run:

```bash
pnpm exec prisma validate
pnpm test:host -- lib/agent-runs/__tests__/schema-smoke.test.ts
```

Expected: Prisma schema validates and the smoke test passes against `TEST_DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/agent-runs/__tests__/schema-smoke.test.ts
git commit -m "feat: add durable agent queue schema for T-20260505-009"
```

---

## Task 2: Add Workspace Access Helpers

**Files:**
- Create: `lib/workspaces/access.ts`
- Test: `lib/workspaces/__tests__/access.test.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Implement access helpers**

Create `lib/workspaces/access.ts`:

```ts
import { prisma } from "@/lib/db/client";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export async function ensureDefaultWorkspaceForUser(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.workspace.findFirst({
    where: { members: { some: { userId: user.id, role: "OWNER" } } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.workspace.create({
    data: {
      name: user.name?.trim() || user.email || "My workspace",
      members: {
        create: {
          userId: user.id,
          role: "OWNER",
        },
      },
    },
    select: { id: true, name: true },
  });
}

export async function findAccessibleProject(input: {
  projectId: string;
  userId: string;
}): Promise<{ id: string; workspaceId: string | null; ownerId: string } | null> {
  return prisma.project.findFirst({
    where: {
      id: input.projectId,
      OR: [
        { ownerId: input.userId },
        { workspace: { members: { some: { userId: input.userId } } } },
      ],
    },
    select: {
      id: true,
      ownerId: true,
      workspaceId: true,
    },
  });
}

export async function requireAccessibleProject(input: {
  projectId: string;
  userId: string;
}): Promise<{ id: string; workspaceId: string | null; ownerId: string }> {
  const project = await findAccessibleProject(input);
  if (!project) throw new Error("project_not_found");
  return project;
}
```

- [ ] **Step 2: Add access tests**

Create `lib/workspaces/__tests__/access.test.ts` with tests that:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  ensureDefaultWorkspaceForUser,
  findAccessibleProject,
} from "../access";

afterEach(async () => {
  await prisma.project.deleteMany({ where: { name: { startsWith: "workspace-access-" } } });
  await prisma.workspace.deleteMany({ where: { name: { startsWith: "workspace-access-" } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: "workspace-access-" } } });
});

describe("workspace access helpers", () => {
  it("creates one default owner workspace per user", async () => {
    const user = await prisma.user.create({
      data: {
        id: "workspace-access-user-1",
        email: "workspace-access-user-1@test.local",
        name: "workspace-access-owner",
      },
    });

    const first = await ensureDefaultWorkspaceForUser(user);
    const second = await ensureDefaultWorkspaceForUser(user);

    expect(second.id).toBe(first.id);
    expect(first.name).toBe("workspace-access-owner");
  });

  it("allows workspace members to access projects", async () => {
    const owner = await prisma.user.create({
      data: { id: "workspace-access-owner", email: "workspace-access-owner@test.local" },
    });
    const member = await prisma.user.create({
      data: { id: "workspace-access-member", email: "workspace-access-member@test.local" },
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: "workspace-access-team",
        members: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: member.id, role: "MEMBER" },
          ],
        },
      },
    });
    const project = await prisma.project.create({
      data: {
        name: "workspace-access-project",
        ownerId: owner.id,
        workspaceId: workspace.id,
      },
    });

    await expect(findAccessibleProject({ projectId: project.id, userId: member.id })).resolves.toMatchObject({
      id: project.id,
      workspaceId: workspace.id,
    });
  });
});
```

- [ ] **Step 3: Assign default workspace on project creation**

In `app/api/projects/route.ts`, import `ensureDefaultWorkspaceForUser`. During project creation, call it after auth and set `workspaceId` in the `prisma.project.create` data.

Use:

```ts
const workspace = await ensureDefaultWorkspaceForUser(currentUser.user);
```

Add:

```ts
workspaceId: workspace.id,
```

to the project create data.

- [ ] **Step 4: Preserve owner access**

In `app/api/projects/[id]/route.ts`, leave owner checks working during migration. Do not remove `ownerId` checks until all routes use workspace membership.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm test:host -- lib/workspaces/__tests__/access.test.ts app/api/projects/__tests__/route.test.ts app/api/projects/[id]/__tests__/route.test.ts
```

Expected: workspace helper tests and existing project route tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/workspaces app/api/projects/route.ts app/api/projects/[id]/route.ts
git commit -m "feat: add workspace access helpers for T-20260505-009"
```

---

## Task 3: Add Agent Run Event Persistence

**Files:**
- Create: `lib/agent-runs/types.ts`
- Create: `lib/agent-runs/events.ts`
- Test: `lib/agent-runs/__tests__/events.test.ts`

- [ ] **Step 1: Add serializers and types**

Create `lib/agent-runs/types.ts`:

```ts
import type { AgentRuntime } from "@wbd/protocol";

export type AgentRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type AgentRunAttemptStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type AgentRunEventType =
  | "STATUS"
  | "CHUNK"
  | "TOOL_USE"
  | "USAGE"
  | "DONE"
  | "ERROR"
  | "FILE_CHANGED";

export type SerializableRunEvent = {
  id: string;
  runId: string;
  attemptId: string | null;
  projectId: string;
  sessionId: string;
  sequence: number;
  type: AgentRunEventType;
  agentId: string | null;
  payload: unknown;
  createdAt: string;
};

export type CreateRunInput = {
  projectId: string;
  sessionId: string;
  createdById: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
};
```

- [ ] **Step 2: Implement event helpers**

Create `lib/agent-runs/events.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import type { SerializableRunEvent } from "./types";

export function serializeRunEvent(event: {
  id: string;
  runId: string;
  attemptId: string | null;
  projectId: string;
  sessionId: string;
  sequence: number;
  type: SerializableRunEvent["type"];
  agentId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): SerializableRunEvent {
  return {
    id: event.id,
    runId: event.runId,
    attemptId: event.attemptId,
    projectId: event.projectId,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type,
    agentId: event.agentId,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function nextProjectEventSequence(projectId: string): Promise<number> {
  const latest = await prisma.agentRunEvent.findFirst({
    where: { projectId },
    select: { sequence: true },
    orderBy: { sequence: "desc" },
  });
  return (latest?.sequence ?? 0) + 1;
}

export async function appendRunEvent(input: {
  runId: string;
  attemptId?: string | null;
  projectId: string;
  sessionId: string;
  type: SerializableRunEvent["type"];
  agentId?: string | null;
  payload: Prisma.InputJsonValue;
}): Promise<SerializableRunEvent> {
  const sequence = await nextProjectEventSequence(input.projectId);
  const event = await prisma.agentRunEvent.create({
    data: {
      runId: input.runId,
      attemptId: input.attemptId ?? null,
      projectId: input.projectId,
      sessionId: input.sessionId,
      sequence,
      type: input.type,
      agentId: input.agentId ?? null,
      payload: input.payload,
    },
  });
  return serializeRunEvent(event);
}

export async function listProjectEvents(input: {
  projectId: string;
  after?: number;
  limit?: number;
}): Promise<SerializableRunEvent[]> {
  const events = await prisma.agentRunEvent.findMany({
    where: {
      projectId: input.projectId,
      ...(input.after ? { sequence: { gt: input.after } } : {}),
    },
    orderBy: { sequence: "asc" },
    take: Math.min(Math.max(input.limit ?? 200, 1), 500),
  });
  return events.map(serializeRunEvent);
}
```

- [ ] **Step 3: Add event tests**

Create `lib/agent-runs/__tests__/events.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { appendRunEvent, listProjectEvents } from "../events";

afterEach(async () => {
  await prisma.agentRunEvent.deleteMany({});
  await prisma.agentRunAttempt.deleteMany({});
  await prisma.agentRun.deleteMany({});
  await prisma.message.deleteMany({ where: { project: { name: { startsWith: "agent-events-" } } } });
  await prisma.session.deleteMany({ where: { project: { name: { startsWith: "agent-events-" } } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: "agent-events-" } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: "agent-events-" } } });
});

async function fixture() {
  const user = await prisma.user.create({
    data: { id: "agent-events-user", email: "agent-events@test.local" },
  });
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: "agent-events-project" },
  });
  const session = await prisma.session.create({
    data: { projectId: project.id, title: "Events" },
  });
  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      sessionId: session.id,
      role: "USER",
      content: "Build it",
    },
  });
  const run = await prisma.agentRun.create({
    data: {
      projectId: project.id,
      sessionId: session.id,
      userMessageId: message.id,
      createdById: user.id,
      runtime: "OPENHANDS",
      providerSessionId: "provider-1",
      queueSequence: 1,
    },
  });
  return { project, session, run };
}

describe("agent run events", () => {
  it("assigns monotone project sequences and replays after a cursor", async () => {
    const { project, session, run } = await fixture();

    const first = await appendRunEvent({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      type: "STATUS",
      payload: { phase: "queued" },
    });
    const second = await appendRunEvent({
      projectId: project.id,
      sessionId: session.id,
      runId: run.id,
      type: "CHUNK",
      payload: { delta: "Hello" },
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    await expect(listProjectEvents({ projectId: project.id, after: 1 })).resolves.toMatchObject([
      { sequence: 2, type: "CHUNK" },
    ]);
  });
});
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test:host -- lib/agent-runs/__tests__/events.test.ts
```

Expected: event sequencing and replay test passes.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-runs/types.ts lib/agent-runs/events.ts lib/agent-runs/__tests__/events.test.ts
git commit -m "feat: persist agent run events for T-20260505-009"
```

---

## Task 4: Add Queue State Transitions

**Files:**
- Create: `lib/agent-runs/queue.ts`
- Test: `lib/agent-runs/__tests__/queue.test.ts`

- [ ] **Step 1: Implement queue helpers**

Create `lib/agent-runs/queue.ts`:

```ts
import type { AgentRuntime } from "@wbd/protocol";
import { prisma } from "@/lib/db/client";
import { protocolRuntimeToDb } from "@/lib/agents/runtime";
import { appendRunEvent } from "./events";

export async function nextProjectQueueSequence(projectId: string): Promise<number> {
  const latest = await prisma.agentRun.findFirst({
    where: { projectId },
    select: { queueSequence: true },
    orderBy: { queueSequence: "desc" },
  });
  return (latest?.queueSequence ?? 0) + 1;
}

export async function enqueueAgentRun(input: {
  projectId: string;
  sessionId: string;
  userId: string;
  prompt: string;
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId?: string | null;
}): Promise<{ runId: string; messageId: string; queueSequence: number }> {
  const runtime = protocolRuntimeToDb(input.runtime);
  const queueSequence = await nextProjectQueueSequence(input.projectId);
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "USER",
        content: input.prompt,
        runtime,
        modelId: input.modelId ?? null,
      },
      select: { id: true },
    });
    const run = await tx.agentRun.create({
      data: {
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessageId: message.id,
        createdById: input.userId,
        runtime,
        providerSessionId: input.providerSessionId,
        modelId: input.modelId ?? null,
        queueSequence,
      },
      select: { id: true },
    });
    await tx.projectQueueState.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, state: "IDLE" },
      update: {},
    });
    await tx.session.update({
      where: { id: input.sessionId },
      data: { lastMessageAt: new Date() },
    });
    return { run, message };
  });

  await appendRunEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    runId: result.run.id,
    type: "STATUS",
    payload: { status: "QUEUED", queueSequence },
  });

  return { runId: result.run.id, messageId: result.message.id, queueSequence };
}

export async function getNextQueuedRun(projectId: string): Promise<{ id: string } | null> {
  return prisma.agentRun.findFirst({
    where: { projectId, status: "QUEUED" },
    select: { id: true },
    orderBy: { queueSequence: "asc" },
  });
}

export async function markRunStarting(runId: string): Promise<{ runId: string; attemptId: string }> {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, projectId: true, sessionId: true, lastAttemptNumber: true },
  });
  const attemptNumber = run.lastAttemptNumber + 1;
  const attempt = await prisma.agentRunAttempt.create({
    data: {
      runId,
      attemptNumber,
      status: "STARTING",
      startedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        lastAttemptNumber: attemptNumber,
      },
    }),
    prisma.projectQueueState.upsert({
      where: { projectId: run.projectId },
      create: { projectId: run.projectId, state: "RUNNING", activeRunId: runId },
      update: { state: "RUNNING", activeRunId: runId, blockedRunId: null, blockedAt: null },
    }),
  ]);
  await appendRunEvent({
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId,
    attemptId: attempt.id,
    type: "STATUS",
    payload: { status: "RUNNING", attemptNumber },
  });
  return { runId, attemptId: attempt.id };
}

export async function markRunSucceeded(input: {
  runId: string;
  attemptId: string;
  agentMessage: string;
}): Promise<void> {
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: input.runId },
    select: { projectId: true, sessionId: true, runtime: true, modelId: true },
  });
  await prisma.$transaction([
    prisma.agentRunAttempt.update({
      where: { id: input.attemptId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), exitCode: 0 },
    }),
    prisma.agentRun.update({
      where: { id: input.runId },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    }),
    prisma.projectQueueState.update({
      where: { projectId: run.projectId },
      data: { state: "IDLE", activeRunId: null },
    }),
    prisma.message.create({
      data: {
        projectId: run.projectId,
        sessionId: run.sessionId,
        role: "AGENT",
        content: input.agentMessage,
        runtime: run.runtime,
        modelId: run.modelId,
      },
    }),
  ]);
  await appendRunEvent({
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId: input.runId,
    attemptId: input.attemptId,
    type: "DONE",
    payload: { status: "SUCCEEDED" },
  });
}

export async function markRunFailed(input: {
  runId: string;
  attemptId: string;
  message: string;
  cancelled?: boolean;
}): Promise<void> {
  const status = input.cancelled ? "CANCELLED" : "FAILED";
  const run = await prisma.agentRun.findUniqueOrThrow({
    where: { id: input.runId },
    select: { projectId: true, sessionId: true },
  });
  await prisma.$transaction([
    prisma.agentRunAttempt.update({
      where: { id: input.attemptId },
      data: { status, finishedAt: new Date(), errorMessage: input.message, exitCode: input.cancelled ? -1 : 1 },
    }),
    prisma.agentRun.update({
      where: { id: input.runId },
      data: { status, finishedAt: new Date(), blockedReason: input.message },
    }),
    prisma.projectQueueState.upsert({
      where: { projectId: run.projectId },
      create: {
        projectId: run.projectId,
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: input.runId,
        blockedAt: new Date(),
      },
      update: {
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: input.runId,
        blockedAt: new Date(),
      },
    }),
  ]);
  await appendRunEvent({
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId: input.runId,
    attemptId: input.attemptId,
    type: "ERROR",
    payload: { status, message: input.message },
  });
}
```

- [ ] **Step 2: Add queue tests**

Create tests that assert:

```ts
it("enqueues runs with project FIFO sequence")
it("marks a run running and creates attempt 1")
it("blocks the project queue on failure")
it("persists final agent message on success")
```

Use the fixture pattern from Task 3 and call the exported helpers.

- [ ] **Step 3: Verify**

Run:

```bash
pnpm test:host -- lib/agent-runs/__tests__/queue.test.ts
```

Expected: queue transition tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/agent-runs/queue.ts lib/agent-runs/__tests__/queue.test.ts
git commit -m "feat: add durable project queue transitions for T-20260505-009"
```

---

## Task 5: Add Run APIs

**Files:**
- Create: `app/api/projects/[id]/runs/route.ts`
- Create: `app/api/projects/[id]/runs/[runId]/retry/route.ts`
- Create: `app/api/projects/[id]/runs/[runId]/skip/route.ts`
- Create: `app/api/projects/[id]/runs/[runId]/cancel/route.ts`
- Create: `app/api/projects/[id]/events/route.ts`
- Test: `app/api/projects/[id]/runs/__tests__/route.test.ts`
- Test: `app/api/projects/[id]/events/__tests__/route.test.ts`

- [ ] **Step 1: Add enqueue/list route**

`POST /api/projects/[id]/runs` should:

1. Require current user.
2. Verify project access with `requireAccessibleProject`.
3. Validate `sessionId`, `prompt`, `runtime`, `providerSessionId`, and optional `modelId`.
4. Verify session belongs to project.
5. Call `enqueueAgentRun`.
6. Trigger queue drain through `requestProjectQueueDrain(projectId)`.
7. Return `{ runId, messageId, queueSequence }`.

`GET /api/projects/[id]/runs` should return active, blocked, and queued runs for the project.

- [ ] **Step 2: Add retry route**

`POST /api/projects/[id]/runs/[runId]/retry` should:

1. Require current user and access.
2. Verify the run belongs to the project and has status `FAILED` or `CANCELLED`.
3. Clear blocked queue state for that run.
4. Set the run to `QUEUED` with the same `queueSequence`.
5. Trigger drain.
6. Return `{ ok: true }`.

Keep the actual attempt creation in `markRunStarting`; retry should not create an attempt until the run is actually picked up.

- [ ] **Step 3: Add skip route**

`POST /api/projects/[id]/runs/[runId]/skip` should:

1. Require current user and access.
2. Verify the project is blocked by the given run.
3. Clear blocked queue state to `IDLE`.
4. Append a `STATUS` event with `{ status: "SKIPPED" }`.
5. Trigger drain.
6. Return `{ ok: true }`.

- [ ] **Step 4: Add cancel route**

`POST /api/projects/[id]/runs/[runId]/cancel` should:

1. Require current user and access.
2. Verify the run belongs to the project.
3. Request broker cancellation through `requestProjectRunCancel(projectId, runId)`.
4. Return `{ ok: true }`.

The broker/executor marks cancellation durable when the provider process stops.

- [ ] **Step 5: Add event replay route**

`GET /api/projects/[id]/events?after=<sequence>` should:

1. Require current user and access.
2. Parse `after` as a non-negative integer.
3. Return `{ events }` from `listProjectEvents`.

- [ ] **Step 6: Verify APIs**

Run:

```bash
pnpm test:host -- app/api/projects/[id]/runs/__tests__/route.test.ts app/api/projects/[id]/events/__tests__/route.test.ts
```

Expected: run enqueue/list/action routes and event replay route pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/projects/[id]/runs app/api/projects/[id]/events lib/agent-runs
git commit -m "feat: expose durable agent run APIs for T-20260505-009"
```

---

## Task 6: Add Host To Broker Queue Commands

**Files:**
- Create: `lib/agent-runs/executor-client.ts`
- Modify: `lib/runtime/worker-pool/types.ts`
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Modify: `container/sandbox/broker/src/index.ts`
- Test: `lib/agent-runs/__tests__/executor-client.test.ts`
- Test: `lib/runtime/worker-pool/__tests__/runtime.test.ts`

- [ ] **Step 1: Add executor client**

Create `lib/agent-runs/executor-client.ts`:

```ts
import { prisma } from "@/lib/db/client";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";

function workerAgentSecret(): string {
  const value = process.env.WORKER_AGENT_HMAC_SECRET;
  if (!value) throw new Error("WORKER_AGENT_HMAC_SECRET is not set");
  return value;
}

async function agentClientForProject(projectId: string) {
  const sandbox = await prisma.workerSandbox.findUnique({
    where: { projectId },
    select: {
      id: true,
      worker: { select: { tailscaleIp: true } },
    },
  });
  if (!sandbox) return null;
  return {
    sandboxId: sandbox.id,
    client: createAgentClient({
      baseUrl: `http://${sandbox.worker.tailscaleIp}:4500`,
      hmacSecret: workerAgentSecret(),
    }),
  };
}

export async function requestProjectQueueDrain(projectId: string): Promise<void> {
  const target = await agentClientForProject(projectId);
  if (!target) return;
  await target.client.drainProjectQueue(target.sandboxId, projectId);
}

export async function requestProjectRunCancel(projectId: string, runId: string): Promise<void> {
  const target = await agentClientForProject(projectId);
  if (!target) return;
  await target.client.cancelProjectRun(target.sandboxId, projectId, runId);
}
```

This host-side boundary must use the same HMAC-signed worker-agent client as
sandbox creation. Do not add an unauthenticated command surface.

- [ ] **Step 2: Add worker-agent command contract**

Extend worker-agent types so a project sandbox can receive:

```ts
type WorkerAgentCommand =
  | { type: "queue.drain"; projectId: string; sandboxId: string }
  | { type: "run.cancel"; projectId: string; sandboxId: string; runId: string };
```

Modify these exact files:

- `lib/runtime/worker-pool/types.ts`: add `drainProjectQueue(sandboxId:
  string, projectId: string): Promise<void>` and `cancelProjectRun(sandboxId:
  string, projectId: string, runId: string): Promise<void>` to `AgentClient`.
- `lib/runtime/worker-pool/agent-client.ts`: add HMAC-signed calls:
  `POST /sandboxes/:id/queue/drain` and
  `POST /sandboxes/:id/runs/:runId/cancel`.
- `lib/runtime/worker-pool/fake-agent-client.ts`: record command requests for
  tests.
- `worker-agent/src/types.ts`: add `BrokerCommandResponse`.
- `worker-agent/src/docker.ts`: extend `DockerClient` with
  `getStatus(sandboxId)` usage only; no Docker exec is needed.
- `worker-agent/src/server.ts`: add HMAC-protected routes that look up the
  sandbox broker host port from `docker.getStatus(sandboxId)` and POST to the
  broker control endpoint on `http://127.0.0.1:<brokerPort>/internal/...`.

- [ ] **Step 3: Add broker command endpoint**

Modify `container/sandbox/broker/src/ws-server.ts` so the underlying HTTP
server created for WebSocket upgrade also handles these internal POST routes on
the same port:

```text
POST /internal/projects/:projectId/queue/drain
POST /internal/projects/:projectId/runs/:runId/cancel
```

The route handlers must call the durable queue drain/cancel functions from Task
8. Require `BROKER_TOKEN` in an `authorization: Bearer <token>` header. Update
`worker-agent/src/server.ts` to forward `BROKER_TOKEN` from the sandbox spec
only as the bearer token to the mapped broker port.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test:host -- lib/agent-runs/__tests__/executor-client.test.ts lib/runtime/worker-pool/__tests__/runtime.test.ts
pnpm --dir worker-agent test -- server.test.ts
```

Expected: host command client, worker-pool forwarding tests, and worker-agent
server command route tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-runs/executor-client.ts lib/runtime/worker-pool worker-agent/src worker-agent/tests container/sandbox/broker/src/ws-server.ts
git commit -m "feat: add project queue command channel for T-20260505-009"
```

---

## Task 7: Add Broker AgentRunExecutor

**Files:**
- Create: `container/sandbox/broker/src/agent-run-executor.ts`
- Modify: `container/sandbox/broker/src/agent-provider.ts`
- Modify: `container/sandbox/broker/src/ws-server.ts`
- Test: `container/sandbox/broker/tests/agent-run-executor.test.ts`
- Test: `container/sandbox/broker/tests/ws-server.test.ts`

- [ ] **Step 1: Extend provider options**

In `container/sandbox/broker/src/agent-provider.ts`, add:

```ts
export interface AgentRunMetadata {
  runId: string;
  attemptId: string;
  conversationId?: string;
  persistenceDir?: string;
  resumeState?: unknown;
}
```

Add optional `run?: AgentRunMetadata` to `AgentTurnOptions`.

- [ ] **Step 2: Create executor boundary**

Create `container/sandbox/broker/src/agent-run-executor.ts`:

```ts
import type { BrokerToHost } from "@wbd/protocol";
import { createAgentProvider } from "./agent-provider-factory";

export type PersistRunEvent = (event: BrokerToHost) => Promise<void>;

export async function executeAgentRun(input: {
  projectId: string;
  sessionId: string;
  providerSessionId: string;
  runId: string;
  attemptId: string;
  prompt: string;
  runtime: "claude-code" | "openai-codex" | "vercel-ai" | "openhands";
  resumeSession: boolean;
  modelId?: string;
  projectRoot: string;
  signal: AbortSignal;
  persistEvent: PersistRunEvent;
  broadcastEvent: (event: BrokerToHost) => void;
}): Promise<void> {
  const provider = createAgentProvider({ runtime: input.runtime });
  await provider.runTurn({
    projectId: input.projectId,
    sessionId: input.providerSessionId,
    resumeSession: input.resumeSession,
    prompt: input.prompt,
    turnId: input.runId,
    projectRoot: input.projectRoot,
    modelId: input.modelId,
    onEvent: async (event) => {
      await input.persistEvent(event);
      input.broadcastEvent(event);
    },
    signal: input.signal,
    run: {
      runId: input.runId,
      attemptId: input.attemptId,
      conversationId: input.providerSessionId,
      persistenceDir: `${input.projectRoot}/.agent-artifacts/openhands/conversations`,
    },
  });
}
```

Change `AgentTurnOptions.onEvent` and `AgentReviewOptions.onEvent` in
`container/sandbox/broker/src/agent-provider.ts` to:

```ts
onEvent: (event: BrokerToHost) => void | Promise<void>;
```

Then update each provider runner to `await` `onEvent(...)` before reading the
next provider event. This preserves the rule that persistence happens before
broadcast.

- [ ] **Step 3: Remove browser-owned execution from ws-server**

In `container/sandbox/broker/src/ws-server.ts`, keep the `agent.prompt` handler
temporarily for backward compatibility but make it return:

```ts
send({
  type: "agent.error",
  turnId: msg.turnId,
  message: "agent.prompt over broker WebSocket is deprecated; enqueue runs through the host API.",
});
```

Do not abort active durable work on socket close.

- [ ] **Step 4: Add executor tests**

Test that `executeAgentRun`:

1. Calls the selected provider.
2. Persists events before broadcasting them.
3. Uses `runId` as `turnId`.
4. Passes OpenHands persistence metadata for OpenHands runs.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm -F @wbd/broker test -- agent-run-executor.test.ts ws-server.test.ts
```

Expected: executor tests pass and WebSocket behavior tests are updated for deprecated `agent.prompt`.

- [ ] **Step 6: Commit**

```bash
git add container/sandbox/broker/src/agent-run-executor.ts container/sandbox/broker/src/agent-provider.ts container/sandbox/broker/src/ws-server.ts container/sandbox/broker/tests
git commit -m "feat: add durable broker run executor for T-20260505-009"
```

---

## Task 8: Implement Queue Drain Worker Logic

**Files:**
- Create: `lib/agent-runs/drain.ts`
- Test: `lib/agent-runs/__tests__/drain.test.ts`
- Modify: `app/api/projects/[id]/runs/route.ts`
- Modify: `app/api/projects/[id]/runs/[runId]/retry/route.ts`
- Modify: `app/api/projects/[id]/runs/[runId]/skip/route.ts`

- [ ] **Step 1: Implement drain service**

Create `lib/agent-runs/drain.ts`:

```ts
import { prisma } from "@/lib/db/client";
import {
  getNextQueuedRun,
  markRunStarting,
  markRunSucceeded,
  markRunFailed,
} from "./queue";

export type RunExecutionAdapter = (input: {
  runId: string;
  attemptId: string;
}) => Promise<{ ok: true; agentMessage: string } | { ok: false; message: string; cancelled?: boolean }>;

export async function drainProjectQueue(input: {
  projectId: string;
  execute: RunExecutionAdapter;
  maxRuns?: number;
}): Promise<{ started: number; stoppedReason: "empty" | "blocked" | "limit" }> {
  let started = 0;
  const maxRuns = input.maxRuns ?? 10;

  while (started < maxRuns) {
    const state = await prisma.projectQueueState.findUnique({
      where: { projectId: input.projectId },
      select: { state: true, activeRunId: true },
    });
    if (state?.state === "BLOCKED") return { started, stoppedReason: "blocked" };
    if (state?.activeRunId) return { started, stoppedReason: "limit" };

    const next = await getNextQueuedRun(input.projectId);
    if (!next) return { started, stoppedReason: "empty" };

    const { runId, attemptId } = await markRunStarting(next.id);
    started += 1;
    const result = await input.execute({ runId, attemptId });
    if (result.ok) {
      await markRunSucceeded({ runId, attemptId, agentMessage: result.agentMessage });
      continue;
    }
    await markRunFailed({
      runId,
      attemptId,
      message: result.message,
      cancelled: result.cancelled,
    });
    return { started, stoppedReason: "blocked" };
  }

  return { started, stoppedReason: "limit" };
}
```

- [ ] **Step 2: Add drain tests**

Test:

```ts
it("runs queued items in FIFO order")
it("stops when a run fails and leaves later runs queued")
it("continues after skip clears the blocked queue")
```

Use a fake `execute` adapter that records run IDs and returns success/failure.

- [ ] **Step 3: Wire API drain triggers**

After enqueue/retry/skip APIs mutate state, call the command channel from Task
6. For local tests, allow injecting `drainProjectQueue` directly through module
mocks.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test:host -- lib/agent-runs/__tests__/drain.test.ts app/api/projects/[id]/runs/__tests__/route.test.ts
```

Expected: drain service and run APIs pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-runs/drain.ts lib/agent-runs/__tests__/drain.test.ts app/api/projects/[id]/runs
git commit -m "feat: drain durable project queues for T-20260505-009"
```

---

## Task 9: Add OpenHands Conversation Persistence

**Files:**
- Modify: `container/sandbox/broker/src/openhands-runner.ts`
- Modify: `container/sandbox/broker/python/openhands_bridge.py`
- Test: `container/sandbox/broker/tests/openhands-runner.test.ts`
- Test: `container/sandbox/broker/python/tests/test_openhands_bridge.py`

- [ ] **Step 1: Pass persistence args from TypeScript**

In `container/sandbox/broker/src/openhands-runner.ts`, extend `spawnBridge`:

```ts
conversationId?: string;
persistenceDir?: string;
```

Append flags:

```ts
if (args.conversationId) argv.push("--conversation-id", args.conversationId);
if (args.persistenceDir) argv.push("--persistence-dir", args.persistenceDir);
```

When `opts.run` exists, pass:

```ts
conversationId: opts.run.conversationId,
persistenceDir: opts.run.persistenceDir,
```

- [ ] **Step 2: Accept bridge args**

In `container/sandbox/broker/python/openhands_bridge.py`, add arguments:

```py
parser.add_argument("--conversation-id")
parser.add_argument("--persistence-dir")
```

When constructing `Conversation`, pass compatible kwargs if the installed SDK
signature accepts them:

```py
conversation_kwargs = {
    "agent": agent,
    "workspace": str(workspace),
    "visualizer": create_visualizer(mod, "OpenHands"),
    "max_iteration_per_run": positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
    "max_iterations": positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
    "conversation_id": args.conversation_id,
    "persistence_dir": args.persistence_dir,
}
conversation = instantiate(mod.Conversation, **conversation_kwargs)
```

Create the persistence directory before constructing the conversation:

```py
if args.persistence_dir:
    Path(args.persistence_dir).mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 3: Add tests**

In `openhands-runner.test.ts`, assert OpenHands argv contains:

```ts
"--conversation-id", "provider-session-id"
"--persistence-dir", "/workspace/project/.agent-artifacts/openhands/conversations"
```

when `run` metadata is supplied.

In `openhands_bridge.py`, extract:

```py
def build_conversation_kwargs(args, agent, workspace, visualizer):
    return {
        "agent": agent,
        "workspace": str(workspace),
        "visualizer": visualizer,
        "max_iteration_per_run": positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
        "max_iterations": positive_int(os.getenv("OPENHANDS_MAX_ITERATIONS")),
        "conversation_id": args.conversation_id,
        "persistence_dir": args.persistence_dir,
    }
```

In `test_openhands_bridge.py`, test that the helper includes
`conversation_id` and `persistence_dir` for an args namespace with both values.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm -F @wbd/broker test -- openhands-runner.test.ts
PYTHONPATH=container/sandbox/broker/python python3 -m unittest container/sandbox/broker/python/tests/test_openhands_bridge.py
```

Expected: runner argv test and Python bridge tests pass.

- [ ] **Step 5: Commit**

```bash
git add container/sandbox/broker/src/openhands-runner.ts container/sandbox/broker/python/openhands_bridge.py container/sandbox/broker/tests/openhands-runner.test.ts container/sandbox/broker/python/tests/test_openhands_bridge.py
git commit -m "feat: persist OpenHands conversations for T-20260505-009"
```

---

## Task 10: Update Workspace UI For Queued Runs

**Files:**
- Modify: `app/project/[id]/page.tsx`
- Modify: `components/chat/Message.tsx`
- Test: `app/project/[id]/__tests__/page-agent-runs.test.tsx`

- [ ] **Step 1: Load runs and replay events**

Add client state:

```ts
type ProjectRunView = {
  id: string;
  sessionId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  queueSequence: number;
  blockedReason: string | null;
};

const [projectRuns, setProjectRuns] = useState<ProjectRunView[]>([]);
const [lastEventSequence, setLastEventSequence] = useState(0);
```

On project load:

1. Fetch `/api/projects/${id}/runs`.
2. Fetch `/api/projects/${id}/events?after=${lastEventSequence}`.
3. Apply event replay before opening live subscription.

- [ ] **Step 2: Submit through run API**

Replace direct `ws.send({ type: "agent.prompt" })` in `onSubmit` with:

```ts
const res = await fetch(`/api/projects/${id}/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sessionId: session.id,
    prompt: text,
    runtime,
    providerSessionId,
    modelId,
    attachments: imageAttachmentsForPrompt(attachments),
  }),
});
```

After success, show the user message with queued state. Do not set `turnInFlight`
from the browser submit; active state comes from run events.

- [ ] **Step 3: Render queue state**

Add project header indicators:

- active run session/title
- queue count
- blocked state

During active or blocked runs, composer remains enabled and button text is
`Queue message`.

- [ ] **Step 4: Add retry/skip actions**

When a blocked run exists, show actions:

```ts
await fetch(`/api/projects/${id}/runs/${blockedRun.id}/retry`, { method: "POST" });
await fetch(`/api/projects/${id}/runs/${blockedRun.id}/skip`, { method: "POST" });
```

- [ ] **Step 5: Remove client-side agent message persistence**

After server-side final message persistence is active, delete or disable
`persistAgentMessages`. Keep user message persistence only through the run
enqueue API.

- [ ] **Step 6: Verify UI behavior**

Run:

```bash
pnpm test:host -- app/project/[id]/__tests__/page-agent-runs.test.tsx
pnpm lint
```

Expected: UI tests pass and lint is clean.

- [ ] **Step 7: Commit**

```bash
git add app/project/[id]/page.tsx components/chat/Message.tsx app/project/[id]/__tests__
git commit -m "feat: queue project chat messages in UI for T-20260505-009"
```

---

## Task 11: Document Runtime Behavior

**Files:**
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md`
- Modify: `docs/superpowers/specs/2026-05-05-durable-project-agent-queue-design.md`
- Test: no automated test required

- [ ] **Step 1: Update runtime docs**

Add a section to `docs/AGENT_RUNTIME_OPTIONS.md`:

```md
## Durable Project Queue

Project chat prompts are persisted as `AgentRun` records and processed through a
project-level FIFO queue. Browser WebSocket connections subscribe to events but
do not own provider execution. Closing the browser does not cancel a running
task. Failed and cancelled runs block the project queue until a user retries or
skips the run.

OpenHands runs use a project-scoped conversation persistence directory under
`.agent-artifacts/openhands/conversations` so follow-up runs in the same chat
session can resume provider context.
```

- [ ] **Step 2: Mark spec implemented**

Update the spec status line:

```md
Status: Implemented
```

only after Tasks 1-10 are complete and verified.

- [ ] **Step 3: Verify docs diff**

Run:

```bash
git diff -- docs/AGENT_RUNTIME_OPTIONS.md docs/superpowers/specs/2026-05-05-durable-project-agent-queue-design.md
```

Expected: docs describe implemented behavior without long historical logs.

- [ ] **Step 4: Commit**

```bash
git add docs/AGENT_RUNTIME_OPTIONS.md docs/superpowers/specs/2026-05-05-durable-project-agent-queue-design.md
git commit -m "docs: document durable project queue for T-20260505-009"
```

---

## Final Verification

Run the smallest complete proof set after all tasks:

```bash
pnpm exec prisma validate
pnpm test:host
pnpm -F @wbd/broker test
PYTHONPATH=container/sandbox/broker/python python3 -m unittest discover container/sandbox/broker/python/tests
pnpm lint
pnpm build
```

Expected:

- Prisma schema validates.
- Host tests pass.
- Broker tests pass.
- Python bridge tests pass.
- ESLint passes.
- Next.js build succeeds.

If DB-backed tests are run locally, set `TEST_DATABASE_URL` to an isolated test
database before running the suite. Never run destructive test cleanup against a
production or shared development database.
