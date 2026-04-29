# Global OpenHands Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a database-managed global personal library for OpenHands skills, agents, and workflow presets with immutable revisions, diff/rollback, deterministic import/export, and per-session snapshots.

**Architecture:** Store library identity and revision history in Prisma, resolve workflow presets into immutable `SessionLibrarySnapshot` rows, and pass a snapshot file to the existing OpenHands Python bridge. The bridge renders only snapshot-selected skills/agents into OpenHands-compatible session files so old sessions remain reproducible.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict mode, Prisma/PostgreSQL, Vitest, OpenHands SDK bridge, existing broker JSONL runtime.

---

## File Structure

Create or modify these files:

- Modify: `prisma/schema.prisma` - add library enums and models.
- Create: `prisma/migrations/20260429170000_add_global_openhands_library/migration.sql` - database migration.
- Create: `lib/library/types.ts` - public TypeScript types for library items, revisions, snapshots, export files, and diffs.
- Create: `lib/library/checksum.ts` - stable JSON stringification and SHA-256 checksums.
- Create: `lib/library/skill-renderer.ts` - render DB skills into OpenHands `SKILL.md`.
- Create: `lib/library/service.ts` - library CRUD, publish, rollback, diff, preset resolution, snapshot creation.
- Create: `lib/library/export-import.ts` - deterministic import/export.
- Create: `lib/library/__tests__/checksum.test.ts`
- Create: `lib/library/__tests__/skill-renderer.test.ts`
- Create: `lib/library/__tests__/service.test.ts`
- Create: `lib/library/__tests__/export-import.test.ts`
- Modify: `lib/agents/session-runtime-state.ts` - serialize runtime library snapshot metadata.
- Modify: `app/api/projects/[id]/sessions/[sessionId]/route.ts` - accept preset selection and create/update snapshots.
- Create: `app/api/library/route.ts` - list and create library items.
- Create: `app/api/library/[itemId]/route.ts` - read/update/archive item metadata.
- Create: `app/api/library/[itemId]/revisions/route.ts` - list/create/publish revisions.
- Create: `app/api/library/[itemId]/revisions/[revisionId]/route.ts` - read revision.
- Create: `app/api/library/[itemId]/rollback/route.ts` - rollback as new revision.
- Create: `app/api/library/[itemId]/diff/route.ts` - revision diff endpoint.
- Create: `app/api/library/export/route.ts` - deterministic export.
- Create: `app/api/library/import/route.ts` - deterministic import.
- Create: `app/api/library/__tests__/route.test.ts`
- Create: `components/library/LibraryList.tsx` - searchable list.
- Create: `components/library/LibraryEditor.tsx` - skill/agent/preset editor shell.
- Create: `components/library/PresetPicker.tsx` - session preset selector.
- Create: `app/library/page.tsx` - library management screen.
- Modify: `app/project/[id]/page.tsx` - show preset picker for OpenHands sessions and send selected preset.
- Modify: `container/sandbox/broker/src/agent-provider.ts` - include optional library snapshot path/payload in turn options.
- Modify: `container/sandbox/broker/src/openhands-runner.ts` - pass snapshot path to the bridge.
- Modify: `container/sandbox/broker/tests/openhands-runner.test.ts` - test snapshot env/argv.
- Modify: `container/sandbox/broker/python/openhands_bridge.py` - load/render snapshot skills and agents.
- Create: `container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py` - Python unit tests for snapshot rendering helpers.
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md` - document global library and snapshot behavior.

---

### Task 1: Add Prisma Models And Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260429170000_add_global_openhands_library/migration.sql`

- [ ] **Step 1: Add the Prisma schema changes**

Add these enums and models after `SessionRuntimeState` in `prisma/schema.prisma`, and add relation fields to `User`, `Project`, `Session`, and `SessionRuntimeState`.

```prisma
model User {
  id           String        @id
  email        String        @unique
  createdAt    DateTime      @default(now())
  projects     Project[]
  libraryItems LibraryItem[]
}

model Project {
  id                      String                   @id @default(cuid())
  ownerId                 String
  owner                   User                     @relation(fields: [ownerId], references: [id])
  name                    String
  status                  ProjectStatus            @default(PROVISIONING)
  agentRuntime            AgentRuntime             @default(CLAUDE_CODE)
  desiredRuntime          AgentRuntime             @default(CLAUDE_CODE)
  runtimeSwitchStatus     RuntimeSwitchStatus      @default(IDLE)
  runtimeGeneration       Int                      @default(1)
  createdAt               DateTime                 @default(now())
  lastActive              DateTime                 @default(now())
  daytonaSandboxId        String?
  brokerUrl               String?
  brokerPreviewToken      String?
  previewUrl              String?
  provisioningError       String?
  sessions                Session[]
  sessionRuntimeStates    SessionRuntimeState[]
  sessionLibrarySnapshots SessionLibrarySnapshot[]
  messages                Message[]
  tokenUsages             TokenUsage[]

  @@index([ownerId])
}

model Session {
  id               String                   @id @default(cuid())
  projectId        String
  project          Project                  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title            String                   @default("untitled")
  defaultRuntime   AgentRuntime             @default(CLAUDE_CODE)
  createdAt        DateTime                 @default(now())
  lastMessageAt    DateTime                 @default(now())
  messages         Message[]
  runtimeStates    SessionRuntimeState[]
  librarySnapshots SessionLibrarySnapshot[]
}

model SessionRuntimeState {
  id                String                   @id @default(cuid())
  projectId         String
  project           Project                  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sessionId         String
  session           Session                  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  runtime           AgentRuntime
  providerSessionId String
  modelId           String?
  resumeState       Json?
  lastUsedAt        DateTime                 @default(now())
  createdAt         DateTime                 @default(now())
  updatedAt         DateTime                 @updatedAt
  librarySnapshots  SessionLibrarySnapshot[]

  @@unique([sessionId, runtime])
  @@unique([runtime, providerSessionId])
  @@index([projectId, sessionId])
}

enum LibraryItemType {
  SKILL
  AGENT
  WORKFLOW_PRESET
}

enum LibraryItemStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model LibraryItem {
  id                String            @id @default(cuid())
  userId            String
  user              User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              LibraryItemType
  slug              String
  name              String
  description       String            @default("")
  tags              String[]          @default([])
  status            LibraryItemStatus @default(DRAFT)
  currentRevisionId String?           @unique
  currentRevision   LibraryRevision?  @relation("CurrentLibraryRevision", fields: [currentRevisionId], references: [id], onDelete: SetNull)
  revisions         LibraryRevision[] @relation("LibraryItemRevisions")
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@unique([userId, type, slug])
  @@index([userId, type, status])
}

model LibraryRevision {
  id              String        @id @default(cuid())
  itemId          String
  item            LibraryItem   @relation("LibraryItemRevisions", fields: [itemId], references: [id], onDelete: Cascade)
  currentForItem  LibraryItem?  @relation("CurrentLibraryRevision")
  version         Int
  title           String
  content         String
  configJson      Json
  checksum        String
  createdAt       DateTime      @default(now())
  createdBy       String
  changeNote      String        @default("")

  @@unique([itemId, version])
  @@unique([itemId, checksum])
  @@index([itemId, createdAt])
}

model SessionLibrarySnapshot {
  id                    String              @id @default(cuid())
  projectId             String
  project               Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sessionId             String
  session               Session             @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionRuntimeStateId String
  sessionRuntimeState   SessionRuntimeState @relation(fields: [sessionRuntimeStateId], references: [id], onDelete: Cascade)
  presetItemId          String?
  presetRevisionId      String?
  snapshotJson          Json
  createdAt             DateTime            @default(now())

  @@index([projectId, sessionId])
  @@index([sessionRuntimeStateId, createdAt])
}
```

- [ ] **Step 2: Create the SQL migration**

Create `prisma/migrations/20260429170000_add_global_openhands_library/migration.sql` with:

```sql
CREATE TYPE "LibraryItemType" AS ENUM ('SKILL', 'AGENT', 'WORKFLOW_PRESET');
CREATE TYPE "LibraryItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "LibraryItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LibraryItemType" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "LibraryItemStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LibraryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryRevision" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "LibraryRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionLibrarySnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionRuntimeStateId" TEXT NOT NULL,
    "presetItemId" TEXT,
    "presetRevisionId" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionLibrarySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryItem_userId_type_slug_key" ON "LibraryItem"("userId", "type", "slug");
CREATE UNIQUE INDEX "LibraryItem_currentRevisionId_key" ON "LibraryItem"("currentRevisionId");
CREATE INDEX "LibraryItem_userId_type_status_idx" ON "LibraryItem"("userId", "type", "status");
CREATE UNIQUE INDEX "LibraryRevision_itemId_version_key" ON "LibraryRevision"("itemId", "version");
CREATE UNIQUE INDEX "LibraryRevision_itemId_checksum_key" ON "LibraryRevision"("itemId", "checksum");
CREATE INDEX "LibraryRevision_itemId_createdAt_idx" ON "LibraryRevision"("itemId", "createdAt");
CREATE INDEX "SessionLibrarySnapshot_projectId_sessionId_idx" ON "SessionLibrarySnapshot"("projectId", "sessionId");
CREATE INDEX "SessionLibrarySnapshot_sessionRuntimeStateId_createdAt_idx" ON "SessionLibrarySnapshot"("sessionRuntimeStateId", "createdAt");

ALTER TABLE "LibraryItem"
ADD CONSTRAINT "LibraryItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LibraryItem"
ADD CONSTRAINT "LibraryItem_currentRevisionId_fkey"
FOREIGN KEY ("currentRevisionId") REFERENCES "LibraryRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LibraryRevision"
ADD CONSTRAINT "LibraryRevision_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "LibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLibrarySnapshot"
ADD CONSTRAINT "SessionLibrarySnapshot_sessionRuntimeStateId_fkey"
FOREIGN KEY ("sessionRuntimeStateId") REFERENCES "SessionRuntimeState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate the Prisma schema**

Run: `pnpm exec prisma validate`

Expected: command exits `0` and prints that the Prisma schema is valid.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260429170000_add_global_openhands_library/migration.sql
git commit -m "feat: add library data model"
```

---

### Task 2: Add Library Types, Checksums, And Skill Rendering

**Files:**
- Create: `lib/library/types.ts`
- Create: `lib/library/checksum.ts`
- Create: `lib/library/skill-renderer.ts`
- Create: `lib/library/__tests__/checksum.test.ts`
- Create: `lib/library/__tests__/skill-renderer.test.ts`

- [ ] **Step 1: Write checksum tests**

Create `lib/library/__tests__/checksum.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checksumPayload, stableStringify } from "../checksum";

describe("library checksum helpers", () => {
  it("stableStringify sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":1}',
    );
  });

  it("checksumPayload is stable for equivalent payloads", () => {
    const first = checksumPayload({ content: "hello", config: { z: true, a: 1 } });
    const second = checksumPayload({ config: { a: 1, z: true }, content: "hello" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run checksum tests to verify they fail**

Run: `pnpm test:host -- lib/library/__tests__/checksum.test.ts`

Expected: FAIL because `../checksum` does not exist.

- [ ] **Step 3: Implement shared types**

Create `lib/library/types.ts`:

```ts
import type { AgentRuntime } from "@wbd/protocol";

export type LibraryItemType = "SKILL" | "AGENT" | "WORKFLOW_PRESET";
export type LibraryItemStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LibrarySkillConfig = {
  description: string;
  triggers: string[];
  allowDynamicCommands: boolean;
};

export type LibraryAgentConfig = {
  delegationName: string;
  allowedTools: string[];
  modelId: string | null;
  registration: "file-agent" | "skill-fallback";
};

export type WorkflowPresetConfig = {
  runtime: AgentRuntime;
  modelId: string | null;
  skills: Array<{ itemId: string; revisionId: string; enabled: boolean }>;
  agents: Array<{ itemId: string; revisionId: string; enabled: boolean }>;
  tools: string[];
  remote: { mode: "local" | "docker" | "api" | "cloud" };
};

export type LibraryRevisionPayload = {
  content: string;
  configJson: unknown;
};

export type ResolvedSkillSnapshot = {
  itemId: string;
  revisionId: string;
  slug: string;
  name: string;
  content: string;
  config: LibrarySkillConfig;
};

export type ResolvedAgentSnapshot = {
  itemId: string;
  revisionId: string;
  slug: string;
  name: string;
  content: string;
  config: LibraryAgentConfig;
};

export type SessionLibrarySnapshotPayload = {
  schemaVersion: 1;
  preset: {
    itemId: string | null;
    revisionId: string | null;
    slug: string | null;
    name: string | null;
  };
  runtime: AgentRuntime;
  modelId: string | null;
  tools: string[];
  remote: { mode: "local" | "docker" | "api" | "cloud" };
  skills: ResolvedSkillSnapshot[];
  agents: ResolvedAgentSnapshot[];
  createdAt: string;
};

export type LibraryExportFile = {
  schemaVersion: 1;
  exportedAt: string;
  items: Array<{
    type: LibraryItemType;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    status: LibraryItemStatus;
    currentRevision: {
      version: number;
      title: string;
      content: string;
      configJson: unknown;
      checksum: string;
      changeNote: string;
    } | null;
  }>;
};
```

- [ ] **Step 4: Implement checksum helpers**

Create `lib/library/checksum.ts`:

```ts
import { createHash } from "node:crypto";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])]),
    );
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function checksumPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
```

- [ ] **Step 5: Write skill renderer tests**

Create `lib/library/__tests__/skill-renderer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "../skill-renderer";

describe("renderSkillMarkdown", () => {
  it("renders OpenHands SKILL.md frontmatter and content", () => {
    const markdown = renderSkillMarkdown({
      name: "Next.js SEO",
      slug: "nextjs-seo",
      content: "# Body\n\nUse metadata correctly.",
      config: {
        description: "SEO guidance for Next.js apps.",
        triggers: ["seo", "metadata"],
        allowDynamicCommands: false,
      },
    });

    expect(markdown).toContain("---\n");
    expect(markdown).toContain("name: nextjs-seo\n");
    expect(markdown).toContain("description: SEO guidance for Next.js apps.\n");
    expect(markdown).toContain("triggers:\n  - seo\n  - metadata\n");
    expect(markdown).toContain("# Body\n\nUse metadata correctly.");
  });
});
```

- [ ] **Step 6: Run renderer tests to verify they fail**

Run: `pnpm test:host -- lib/library/__tests__/skill-renderer.test.ts`

Expected: FAIL because `../skill-renderer` does not exist.

- [ ] **Step 7: Implement the skill renderer**

Create `lib/library/skill-renderer.ts`:

```ts
import type { LibrarySkillConfig } from "./types";

function yamlString(value: string): string {
  if (/^[a-zA-Z0-9 _./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function renderSkillMarkdown(input: {
  slug: string;
  name: string;
  content: string;
  config: LibrarySkillConfig;
}): string {
  const triggerLines = input.config.triggers.length
    ? `triggers:\n${input.config.triggers.map((trigger) => `  - ${yamlString(trigger)}`).join("\n")}\n`
    : "";

  return [
    "---",
    `name: ${yamlString(input.slug)}`,
    `description: ${yamlString(input.config.description || input.name)}`,
    triggerLines.trimEnd(),
    "---",
    "",
    input.content.trim(),
    "",
  ].filter((line, index) => line !== "" || index > 3).join("\n");
}
```

- [ ] **Step 8: Run tests**

Run: `pnpm test:host -- lib/library/__tests__/checksum.test.ts lib/library/__tests__/skill-renderer.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/library/types.ts lib/library/checksum.ts lib/library/skill-renderer.ts lib/library/__tests__/checksum.test.ts lib/library/__tests__/skill-renderer.test.ts
git commit -m "feat: add library serialization helpers"
```

---

### Task 3: Implement Library Service With Revision And Snapshot Logic

**Files:**
- Create: `lib/library/service.ts`
- Create: `lib/library/__tests__/service.test.ts`

- [ ] **Step 1: Write service tests**

Create `lib/library/__tests__/service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  createLibraryItem,
  createSessionLibrarySnapshot,
  publishLibraryRevision,
  resolveWorkflowPreset,
  rollbackLibraryItem,
} from "../service";

const userId = "library-service-user";

beforeEach(async () => {
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryRevision.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.sessionRuntimeState.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({ data: { id: userId, email: "library-service@example.com" } });
});

describe("library service", () => {
  it("publishes immutable revisions and rolls back as a new revision", async () => {
    const item = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "nextjs-seo",
      name: "Next.js SEO",
      description: "SEO skill",
      tags: ["nextjs"],
    });

    const first = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Initial",
      content: "v1",
      configJson: { description: "SEO skill", triggers: ["seo"], allowDynamicCommands: false },
      changeNote: "first",
    });
    const second = await publishLibraryRevision({
      userId,
      itemId: item.id,
      title: "Second",
      content: "v2",
      configJson: { description: "SEO skill", triggers: ["seo"], allowDynamicCommands: false },
      changeNote: "second",
    });
    const rollback = await rollbackLibraryItem({
      userId,
      itemId: item.id,
      revisionId: first.id,
      changeNote: "rollback to v1",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(rollback.version).toBe(3);
    expect(rollback.content).toBe("v1");
    const current = await prisma.libraryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(current.currentRevisionId).toBe(rollback.id);
  });

  it("resolves presets into fully materialized snapshots", async () => {
    const skill = await createLibraryItem({
      userId,
      type: "SKILL",
      slug: "nextjs-seo",
      name: "Next.js SEO",
      description: "SEO skill",
      tags: [],
    });
    const skillRevision = await publishLibraryRevision({
      userId,
      itemId: skill.id,
      title: "Skill v1",
      content: "Use metadata.",
      configJson: { description: "SEO skill", triggers: ["seo"], allowDynamicCommands: false },
      changeNote: "",
    });
    const preset = await createLibraryItem({
      userId,
      type: "WORKFLOW_PRESET",
      slug: "next-builder",
      name: "Next Builder",
      description: "Build Next.js apps",
      tags: [],
    });
    const presetRevision = await publishLibraryRevision({
      userId,
      itemId: preset.id,
      title: "Preset v1",
      content: "",
      configJson: {
        runtime: "openhands",
        modelId: "openrouter:qwen/qwen3-coder:free",
        skills: [{ itemId: skill.id, revisionId: skillRevision.id, enabled: true }],
        agents: [],
        tools: ["TerminalTool", "FileEditorTool"],
        remote: { mode: "local" },
      },
      changeNote: "",
    });

    const resolved = await resolveWorkflowPreset({ userId, presetItemId: preset.id });
    expect(resolved.preset.revisionId).toBe(presetRevision.id);
    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0]).toMatchObject({
      itemId: skill.id,
      revisionId: skillRevision.id,
      content: "Use metadata.",
    });
  });

  it("stores session snapshots with resolved content", async () => {
    const project = await prisma.project.create({
      data: {
        ownerId: userId,
        name: "Project",
        status: "RUNNING",
        sessions: { create: { title: "Main chat", defaultRuntime: "OPENHANDS" } },
      },
      include: { sessions: true },
    });
    const session = project.sessions[0];
    const runtimeState = await prisma.sessionRuntimeState.create({
      data: {
        projectId: project.id,
        sessionId: session.id,
        runtime: "OPENHANDS",
        providerSessionId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const snapshot = await createSessionLibrarySnapshot({
      projectId: project.id,
      sessionId: session.id,
      sessionRuntimeStateId: runtimeState.id,
      payload: {
        schemaVersion: 1,
        preset: { itemId: null, revisionId: null, slug: null, name: null },
        runtime: "openhands",
        modelId: null,
        tools: ["TerminalTool"],
        remote: { mode: "local" },
        skills: [],
        agents: [],
        createdAt: "2026-04-29T00:00:00.000Z",
      },
    });

    expect(snapshot.snapshotJson).toMatchObject({ schemaVersion: 1, tools: ["TerminalTool"] });
  });
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run: `pnpm test:host -- lib/library/__tests__/service.test.ts`

Expected: FAIL because `../service` does not exist.

- [ ] **Step 3: Implement the service**

Create `lib/library/service.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { checksumPayload } from "./checksum";
import type {
  LibraryAgentConfig,
  LibraryItemType,
  LibrarySkillConfig,
  SessionLibrarySnapshotPayload,
  WorkflowPresetConfig,
} from "./types";

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asSkillConfig(value: unknown): LibrarySkillConfig {
  const obj = assertObject(value, "skill config");
  return {
    description: typeof obj.description === "string" ? obj.description : "",
    triggers: Array.isArray(obj.triggers) ? obj.triggers.filter((item): item is string => typeof item === "string") : [],
    allowDynamicCommands: obj.allowDynamicCommands === true,
  };
}

function asAgentConfig(value: unknown): LibraryAgentConfig {
  const obj = assertObject(value, "agent config");
  return {
    delegationName: typeof obj.delegationName === "string" ? obj.delegationName : "",
    allowedTools: Array.isArray(obj.allowedTools) ? obj.allowedTools.filter((item): item is string => typeof item === "string") : [],
    modelId: typeof obj.modelId === "string" ? obj.modelId : null,
    registration: obj.registration === "file-agent" ? "file-agent" : "skill-fallback",
  };
}

function asPresetConfig(value: unknown): WorkflowPresetConfig {
  const obj = assertObject(value, "preset config");
  const remote = assertObject(obj.remote ?? { mode: "local" }, "preset remote");
  return {
    runtime: obj.runtime === "openhands" ? "openhands" : "openhands",
    modelId: typeof obj.modelId === "string" ? obj.modelId : null,
    skills: Array.isArray(obj.skills)
      ? obj.skills.map((item) => {
          const skill = assertObject(item, "preset skill");
          return {
            itemId: String(skill.itemId ?? ""),
            revisionId: String(skill.revisionId ?? ""),
            enabled: skill.enabled !== false,
          };
        }).filter((item) => item.itemId && item.revisionId)
      : [],
    agents: Array.isArray(obj.agents)
      ? obj.agents.map((item) => {
          const agent = assertObject(item, "preset agent");
          return {
            itemId: String(agent.itemId ?? ""),
            revisionId: String(agent.revisionId ?? ""),
            enabled: agent.enabled !== false,
          };
        }).filter((item) => item.itemId && item.revisionId)
      : [],
    tools: Array.isArray(obj.tools) ? obj.tools.filter((item): item is string => typeof item === "string") : [],
    remote: { mode: remote.mode === "docker" || remote.mode === "api" || remote.mode === "cloud" ? remote.mode : "local" },
  };
}

export async function createLibraryItem(input: {
  userId: string;
  type: LibraryItemType;
  slug: string;
  name: string;
  description: string;
  tags: string[];
}) {
  return prisma.libraryItem.create({
    data: {
      userId: input.userId,
      type: input.type,
      slug: input.slug,
      name: input.name,
      description: input.description,
      tags: input.tags,
    },
  });
}

export async function publishLibraryRevision(input: {
  userId: string;
  itemId: string;
  title: string;
  content: string;
  configJson: Prisma.InputJsonValue;
  changeNote: string;
}) {
  const item = await prisma.libraryItem.findFirstOrThrow({
    where: { id: input.itemId, userId: input.userId },
    include: { revisions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } },
  });
  const checksum = checksumPayload({ content: input.content, configJson: input.configJson });
  const version = (item.revisions[0]?.version ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    const revision = await tx.libraryRevision.create({
      data: {
        itemId: item.id,
        version,
        title: input.title,
        content: input.content,
        configJson: input.configJson,
        checksum,
        createdBy: input.userId,
        changeNote: input.changeNote,
      },
    });
    await tx.libraryItem.update({
      where: { id: item.id },
      data: { currentRevisionId: revision.id, status: "PUBLISHED" },
    });
    return revision;
  });
}

export async function rollbackLibraryItem(input: {
  userId: string;
  itemId: string;
  revisionId: string;
  changeNote: string;
}) {
  const revision = await prisma.libraryRevision.findFirstOrThrow({
    where: { id: input.revisionId, item: { id: input.itemId, userId: input.userId } },
  });
  return publishLibraryRevision({
    userId: input.userId,
    itemId: input.itemId,
    title: `Rollback to v${revision.version}`,
    content: revision.content,
    configJson: revision.configJson as Prisma.InputJsonValue,
    changeNote: input.changeNote,
  });
}

export async function resolveWorkflowPreset(input: {
  userId: string;
  presetItemId: string;
  presetRevisionId?: string;
}): Promise<SessionLibrarySnapshotPayload> {
  const preset = await prisma.libraryItem.findFirstOrThrow({
    where: { id: input.presetItemId, userId: input.userId, type: "WORKFLOW_PRESET", status: { not: "ARCHIVED" } },
    include: {
      currentRevision: true,
      revisions: input.presetRevisionId ? { where: { id: input.presetRevisionId } } : false,
    },
  });
  const presetRevision = input.presetRevisionId ? preset.revisions[0] : preset.currentRevision;
  if (!presetRevision) throw new Error("preset has no published revision");
  const config = asPresetConfig(presetRevision.configJson);

  const skillEntries = config.skills.filter((item) => item.enabled);
  const agentEntries = config.agents.filter((item) => item.enabled);
  const revisionIds = [...skillEntries, ...agentEntries].map((item) => item.revisionId);
  const revisions = await prisma.libraryRevision.findMany({
    where: { id: { in: revisionIds }, item: { userId: input.userId, status: { not: "ARCHIVED" } } },
    include: { item: true },
  });
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));

  return {
    schemaVersion: 1,
    preset: {
      itemId: preset.id,
      revisionId: presetRevision.id,
      slug: preset.slug,
      name: preset.name,
    },
    runtime: config.runtime,
    modelId: config.modelId,
    tools: config.tools,
    remote: config.remote,
    skills: skillEntries.map((entry) => {
      const revision = byId.get(entry.revisionId);
      if (!revision || revision.item.type !== "SKILL") throw new Error(`missing skill revision ${entry.revisionId}`);
      return {
        itemId: revision.itemId,
        revisionId: revision.id,
        slug: revision.item.slug,
        name: revision.item.name,
        content: revision.content,
        config: asSkillConfig(revision.configJson),
      };
    }),
    agents: agentEntries.map((entry) => {
      const revision = byId.get(entry.revisionId);
      if (!revision || revision.item.type !== "AGENT") throw new Error(`missing agent revision ${entry.revisionId}`);
      return {
        itemId: revision.itemId,
        revisionId: revision.id,
        slug: revision.item.slug,
        name: revision.item.name,
        content: revision.content,
        config: asAgentConfig(revision.configJson),
      };
    }),
    createdAt: new Date().toISOString(),
  };
}

export async function createSessionLibrarySnapshot(input: {
  projectId: string;
  sessionId: string;
  sessionRuntimeStateId: string;
  presetItemId?: string | null;
  presetRevisionId?: string | null;
  payload: SessionLibrarySnapshotPayload;
}) {
  return prisma.sessionLibrarySnapshot.create({
    data: {
      projectId: input.projectId,
      sessionId: input.sessionId,
      sessionRuntimeStateId: input.sessionRuntimeStateId,
      presetItemId: input.presetItemId ?? input.payload.preset.itemId,
      presetRevisionId: input.presetRevisionId ?? input.payload.preset.revisionId,
      snapshotJson: input.payload as unknown as Prisma.InputJsonValue,
    },
  });
}
```

- [ ] **Step 4: Run service tests**

Run: `pnpm test:host -- lib/library/__tests__/service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/library/service.ts lib/library/__tests__/service.test.ts
git commit -m "feat: add library revision service"
```

---

### Task 4: Add Deterministic Import And Export

**Files:**
- Create: `lib/library/export-import.ts`
- Create: `lib/library/__tests__/export-import.test.ts`

- [ ] **Step 1: Write import/export tests**

Create `lib/library/__tests__/export-import.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { exportLibrary, importLibrary } from "../export-import";
import { createLibraryItem, publishLibraryRevision } from "../service";

const userId = "library-export-user";

beforeEach(async () => {
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryRevision.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({ data: { id: userId, email: "library-export@example.com" } });
});

describe("library import/export", () => {
  it("exports current revisions in stable slug order", async () => {
    const b = await createLibraryItem({ userId, type: "SKILL", slug: "b-skill", name: "B", description: "", tags: [] });
    const a = await createLibraryItem({ userId, type: "SKILL", slug: "a-skill", name: "A", description: "", tags: [] });
    await publishLibraryRevision({ userId, itemId: b.id, title: "B1", content: "b", configJson: { description: "", triggers: [], allowDynamicCommands: false }, changeNote: "" });
    await publishLibraryRevision({ userId, itemId: a.id, title: "A1", content: "a", configJson: { description: "", triggers: [], allowDynamicCommands: false }, changeNote: "" });

    const exported = await exportLibrary({ userId, exportedAt: "2026-04-29T00:00:00.000Z" });
    expect(exported.items.map((item) => item.slug)).toEqual(["a-skill", "b-skill"]);
    expect(exported.items[0].currentRevision?.content).toBe("a");
  });

  it("imports changed content as a new revision", async () => {
    const item = await createLibraryItem({ userId, type: "SKILL", slug: "nextjs", name: "Next.js", description: "", tags: [] });
    await publishLibraryRevision({ userId, itemId: item.id, title: "v1", content: "old", configJson: { description: "", triggers: [], allowDynamicCommands: false }, changeNote: "" });

    const result = await importLibrary({
      userId,
      file: {
        schemaVersion: 1,
        exportedAt: "2026-04-29T00:00:00.000Z",
        items: [{
          type: "SKILL",
          slug: "nextjs",
          name: "Next.js",
          description: "",
          tags: [],
          status: "PUBLISHED",
          currentRevision: {
            version: 1,
            title: "v2",
            content: "new",
            configJson: { description: "", triggers: [], allowDynamicCommands: false },
            checksum: "",
            changeNote: "import",
          },
        }],
      },
    });

    expect(result.createdItems).toBe(0);
    expect(result.createdRevisions).toBe(1);
    const revisions = await prisma.libraryRevision.findMany({ where: { itemId: item.id }, orderBy: { version: "asc" } });
    expect(revisions.map((revision) => revision.content)).toEqual(["old", "new"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:host -- lib/library/__tests__/export-import.test.ts`

Expected: FAIL because `../export-import` does not exist.

- [ ] **Step 3: Implement import/export**

Create `lib/library/export-import.ts`:

```ts
import { prisma } from "@/lib/db/client";
import { checksumPayload } from "./checksum";
import { createLibraryItem, publishLibraryRevision } from "./service";
import type { LibraryExportFile } from "./types";

export async function exportLibrary(input: {
  userId: string;
  exportedAt?: string;
}): Promise<LibraryExportFile> {
  const items = await prisma.libraryItem.findMany({
    where: { userId: input.userId },
    include: { currentRevision: true },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
  });

  return {
    schemaVersion: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    items: items.map((item) => ({
      type: item.type,
      slug: item.slug,
      name: item.name,
      description: item.description,
      tags: [...item.tags].sort(),
      status: item.status,
      currentRevision: item.currentRevision
        ? {
            version: item.currentRevision.version,
            title: item.currentRevision.title,
            content: item.currentRevision.content,
            configJson: item.currentRevision.configJson,
            checksum: item.currentRevision.checksum,
            changeNote: item.currentRevision.changeNote,
          }
        : null,
    })),
  };
}

export async function importLibrary(input: {
  userId: string;
  file: LibraryExportFile;
}): Promise<{ createdItems: number; createdRevisions: number; skippedRevisions: number }> {
  let createdItems = 0;
  let createdRevisions = 0;
  let skippedRevisions = 0;

  for (const exportedItem of input.file.items) {
    let item = await prisma.libraryItem.findUnique({
      where: {
        userId_type_slug: {
          userId: input.userId,
          type: exportedItem.type,
          slug: exportedItem.slug,
        },
      },
    });

    if (!item) {
      item = await createLibraryItem({
        userId: input.userId,
        type: exportedItem.type,
        slug: exportedItem.slug,
        name: exportedItem.name,
        description: exportedItem.description,
        tags: exportedItem.tags,
      });
      createdItems += 1;
    }

    if (!exportedItem.currentRevision) continue;
    const checksum = checksumPayload({
      content: exportedItem.currentRevision.content,
      configJson: exportedItem.currentRevision.configJson,
    });
    const existing = await prisma.libraryRevision.findUnique({
      where: { itemId_checksum: { itemId: item.id, checksum } },
    });
    if (existing) {
      skippedRevisions += 1;
      continue;
    }

    await publishLibraryRevision({
      userId: input.userId,
      itemId: item.id,
      title: exportedItem.currentRevision.title,
      content: exportedItem.currentRevision.content,
      configJson: exportedItem.currentRevision.configJson,
      changeNote: exportedItem.currentRevision.changeNote || "Imported revision",
    });
    createdRevisions += 1;
  }

  return { createdItems, createdRevisions, skippedRevisions };
}
```

- [ ] **Step 4: Run import/export tests**

Run: `pnpm test:host -- lib/library/__tests__/export-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/library/export-import.ts lib/library/__tests__/export-import.test.ts
git commit -m "feat: add library import export"
```

---

### Task 5: Add Library API Routes

**Files:**
- Create: `app/api/library/route.ts`
- Create: `app/api/library/[itemId]/route.ts`
- Create: `app/api/library/[itemId]/revisions/route.ts`
- Create: `app/api/library/[itemId]/revisions/[revisionId]/route.ts`
- Create: `app/api/library/[itemId]/rollback/route.ts`
- Create: `app/api/library/[itemId]/diff/route.ts`
- Create: `app/api/library/export/route.ts`
- Create: `app/api/library/import/route.ts`
- Create: `app/api/library/__tests__/route.test.ts`

- [ ] **Step 1: Write API route tests**

Create `app/api/library/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { GET as listLibrary, POST as createLibrary } from "../route";

const userId = "library-api-user";
const originalDevUserId = process.env.DEV_USER_ID;

beforeEach(async () => {
  process.env.DEV_USER_ID = userId;
  await prisma.sessionLibrarySnapshot.deleteMany({});
  await prisma.libraryRevision.deleteMany({});
  await prisma.libraryItem.deleteMany({});
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({ data: { id: userId, email: "library-api@example.com" } });
});

afterAll(() => {
  if (originalDevUserId === undefined) delete process.env.DEV_USER_ID;
  else process.env.DEV_USER_ID = originalDevUserId;
});

describe("library API", () => {
  it("creates and lists library items for the dev user", async () => {
    const createResponse = await createLibrary(new Request("http://test.local/api/library", {
      method: "POST",
      body: JSON.stringify({
        type: "SKILL",
        slug: "nextjs-seo",
        name: "Next.js SEO",
        description: "SEO skill",
        tags: ["nextjs"],
      }),
    }));
    expect(createResponse.status).toBe(201);

    const listResponse = await listLibrary(new Request("http://test.local/api/library"));
    const body = await listResponse.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ slug: "nextjs-seo", type: "SKILL" });
  });

  it("rejects invalid item type", async () => {
    const response = await createLibrary(new Request("http://test.local/api/library", {
      method: "POST",
      body: JSON.stringify({ type: "BAD", slug: "bad", name: "Bad" }),
    }));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run API tests to verify they fail**

Run: `pnpm test:host -- app/api/library/__tests__/route.test.ts`

Expected: FAIL because `app/api/library/route.ts` does not exist.

- [ ] **Step 3: Implement the list/create route**

Create `app/api/library/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createLibraryItem } from "@/lib/library/service";
import type { LibraryItemType } from "@/lib/library/types";

const ITEM_TYPES = new Set<LibraryItemType>(["SKILL", "AGENT", "WORKFLOW_PRESET"]);

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const items = await prisma.libraryItem.findMany({
    where: {
      userId: devUserId(),
      ...(type && ITEM_TYPES.has(type as LibraryItemType) ? { type: type as LibraryItemType } : {}),
    },
    include: { currentRevision: true },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    type?: unknown;
    slug?: unknown;
    name?: unknown;
    description?: unknown;
    tags?: unknown;
  };
  const type = typeof body.type === "string" && ITEM_TYPES.has(body.type as LibraryItemType)
    ? body.type as LibraryItemType
    : null;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!type || !slug || !name) {
    return NextResponse.json({ error: "type, slug, and name are required" }, { status: 400 });
  }

  const item = await createLibraryItem({
    userId: devUserId(),
    type,
    slug,
    name,
    description: typeof body.description === "string" ? body.description : "",
    tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
  });
  return NextResponse.json({ item }, { status: 201 });
}
```

- [ ] **Step 4: Implement item, revision, rollback, diff, export, and import routes**

Use the same `devUserId()` and ownership pattern. Keep route handlers thin; call service functions.

Create `app/api/library/[itemId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const item = await prisma.libraryItem.findFirst({
    where: { id: itemId, userId: devUserId() },
    include: { currentRevision: true, revisions: { orderBy: { version: "desc" } } },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    status?: unknown;
  };
  const item = await prisma.libraryItem.findFirst({ where: { id: itemId, userId: devUserId() } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  const updated = await prisma.libraryItem.update({
    where: { id: item.id },
    data: {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.filter((tag): tag is string => typeof tag === "string") } : {}),
      ...(body.status === "DRAFT" || body.status === "PUBLISHED" || body.status === "ARCHIVED" ? { status: body.status } : {}),
    },
  });
  return NextResponse.json({ item: updated });
}
```

Create `app/api/library/[itemId]/revisions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { publishLibraryRevision } from "@/lib/library/service";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const item = await prisma.libraryItem.findFirst({ where: { id: itemId, userId: devUserId() } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  const revisions = await prisma.libraryRevision.findMany({
    where: { itemId: item.id },
    orderBy: { version: "desc" },
  });
  return NextResponse.json({ revisions });
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    content?: unknown;
    configJson?: unknown;
    changeNote?: unknown;
  };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!title || body.configJson === undefined) {
    return NextResponse.json({ error: "title and configJson are required" }, { status: 400 });
  }
  try {
    const revision = await publishLibraryRevision({
      userId: devUserId(),
      itemId,
      title,
      content,
      configJson: body.configJson,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : "",
    });
    return NextResponse.json({ revision }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

Create `app/api/library/[itemId]/revisions/[revisionId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string; revisionId: string }> },
) {
  const { itemId, revisionId } = await params;
  const revision = await prisma.libraryRevision.findFirst({
    where: { id: revisionId, itemId, item: { userId: devUserId() } },
  });
  if (!revision) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ revision });
}
```

Create `app/api/library/[itemId]/rollback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { rollbackLibraryItem } from "@/lib/library/service";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    revisionId?: unknown;
    changeNote?: unknown;
  };
  if (typeof body.revisionId !== "string") {
    return NextResponse.json({ error: "revisionId is required" }, { status: 400 });
  }
  try {
    const revision = await rollbackLibraryItem({
      userId: devUserId(),
      itemId,
      revisionId: body.revisionId,
      changeNote: typeof body.changeNote === "string" ? body.changeNote : "Rollback",
    });
    return NextResponse.json({ revision }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

Create `app/api/library/[itemId]/diff/route.ts`:

```ts
import { NextResponse } from "next/server";
import { stableStringify } from "@/lib/library/checksum";
import { prisma } from "@/lib/db/client";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const url = new URL(request.url);
  const fromRevisionId = url.searchParams.get("fromRevisionId");
  const toRevisionId = url.searchParams.get("toRevisionId");
  if (!fromRevisionId || !toRevisionId) {
    return NextResponse.json({ error: "fromRevisionId and toRevisionId are required" }, { status: 400 });
  }
  const revisions = await prisma.libraryRevision.findMany({
    where: {
      itemId,
      id: { in: [fromRevisionId, toRevisionId] },
      item: { userId: devUserId() },
    },
  });
  const from = revisions.find((revision) => revision.id === fromRevisionId);
  const to = revisions.find((revision) => revision.id === toRevisionId);
  if (!from || !to) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    from: { id: from.id, version: from.version, contentLines: from.content.split("\n") },
    to: { id: to.id, version: to.version, contentLines: to.content.split("\n") },
    configChanged: stableStringify(from.configJson) !== stableStringify(to.configJson),
  });
}
```

Create `app/api/library/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { exportLibrary } from "@/lib/library/export-import";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function GET() {
  return NextResponse.json(await exportLibrary({ userId: devUserId() }));
}
```

Create `app/api/library/import/route.ts`:

```ts
import { NextResponse } from "next/server";
import { importLibrary } from "@/lib/library/export-import";
import type { LibraryExportFile } from "@/lib/library/types";

function devUserId(): string {
  return process.env.DEV_USER_ID ?? "dev-user";
}

export async function POST(request: Request) {
  const file = (await request.json().catch(() => null)) as LibraryExportFile | null;
  if (!file || file.schemaVersion !== 1 || !Array.isArray(file.items)) {
    return NextResponse.json({ error: "invalid library export file" }, { status: 400 });
  }
  const result = await importLibrary({ userId: devUserId(), file });
  return NextResponse.json(result);
}
```

- [ ] **Step 5: Run API tests**

Run: `pnpm test:host -- app/api/library/__tests__/route.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/library lib/library
git commit -m "feat: add library api routes"
```

---

### Task 6: Attach Library Snapshots To Session Runtime State

**Files:**
- Modify: `lib/agents/session-runtime-state.ts`
- Modify: `app/api/projects/[id]/sessions/[sessionId]/route.ts`

- [ ] **Step 1: Add a route test for preset snapshot creation**

Add a test file or extend the existing session route tests. If no test exists, create `app/api/projects/[id]/sessions/[sessionId]/__tests__/route.test.ts` with a PATCH case that sends:

```json
{
  "runtimeState": {
    "runtime": "openhands",
    "providerSessionId": "11111111-1111-4111-8111-111111111111",
    "modelId": "openrouter:qwen/qwen3-coder:free",
    "libraryPresetItemId": "<preset-id>"
  }
}
```

Assert:

```ts
expect(response.status).toBe(200);
expect(body.session.runtimeStates[0].librarySnapshot).toMatchObject({
  presetItemId: preset.id,
  presetRevisionId: presetRevision.id,
});
```

- [ ] **Step 2: Update session runtime serialization**

Modify `lib/agents/session-runtime-state.ts` so `sessionRuntimeStateSelect` includes the latest snapshot:

```ts
export const sessionRuntimeStateSelect = {
  runtime: true,
  providerSessionId: true,
  modelId: true,
  lastUsedAt: true,
  librarySnapshots: {
    take: 1,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      presetItemId: true,
      presetRevisionId: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SessionRuntimeStateSelect;
```

Update the shape and serializer:

```ts
type SessionRuntimeStateShape = {
  runtime: AgentRuntime;
  providerSessionId: string;
  modelId: string | null;
  lastUsedAt: Date;
  librarySnapshots?: Array<{
    id: string;
    presetItemId: string | null;
    presetRevisionId: string | null;
    createdAt: Date;
  }>;
};

export function serializeRuntimeState<T extends SessionRuntimeStateShape>(state: T) {
  const [librarySnapshot] = state.librarySnapshots ?? [];
  return {
    runtime: dbRuntimeToProtocol(state.runtime),
    providerSessionId: state.providerSessionId,
    modelId: state.modelId,
    lastUsedAt: state.lastUsedAt,
    ...(librarySnapshot ? { librarySnapshot } : {}),
  };
}
```

- [ ] **Step 3: Extend session PATCH parsing**

In `app/api/projects/[id]/sessions/[sessionId]/route.ts`, extend `runtimeState` parsing:

```ts
type RuntimeStatePatch = {
  runtime?: unknown;
  providerSessionId?: unknown;
  modelId?: unknown;
  libraryPresetItemId?: unknown;
  libraryPresetRevisionId?: unknown;
};
```

After `sessionRuntimeState.upsert`, resolve and create the snapshot when `libraryPresetItemId` is a string:

```ts
const runtimeStateRow = await prisma.sessionRuntimeState.upsert({
  where: { sessionId_runtime: { sessionId: existing.id, runtime } },
  create: {
    projectId: id,
    sessionId: existing.id,
    runtime,
    providerSessionId,
    modelId: typeof runtimeState?.modelId === "string" ? runtimeState.modelId : null,
  },
  update: {
    providerSessionId,
    modelId: typeof runtimeState?.modelId === "string" ? runtimeState.modelId : null,
    lastUsedAt: new Date(),
  },
});

if (runtime === "OPENHANDS" && typeof runtimeState?.libraryPresetItemId === "string") {
  const payload = await resolveWorkflowPreset({
    userId: DEV_USER_ID,
    presetItemId: runtimeState.libraryPresetItemId,
    presetRevisionId: typeof runtimeState.libraryPresetRevisionId === "string"
      ? runtimeState.libraryPresetRevisionId
      : undefined,
  });
  await createSessionLibrarySnapshot({
    projectId: id,
    sessionId: existing.id,
    sessionRuntimeStateId: runtimeStateRow.id,
    payload,
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:host -- app/api/projects/[id]/sessions/[sessionId]/__tests__/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/session-runtime-state.ts 'app/api/projects/[id]/sessions/[sessionId]/route.ts' 'app/api/projects/[id]/sessions/[sessionId]/__tests__/route.test.ts'
git commit -m "feat: attach library snapshots to sessions"
```

---

### Task 7: Pass Library Snapshots Into The OpenHands Bridge

**Files:**
- Modify: `container/sandbox/broker/src/agent-provider.ts`
- Modify: `container/sandbox/broker/src/openhands-runner.ts`
- Modify: `container/sandbox/broker/tests/openhands-runner.test.ts`

- [ ] **Step 1: Write runner test for snapshot path**

Add this test to `container/sandbox/broker/tests/openhands-runner.test.ts`:

```ts
it("passes library snapshot path to the OpenHands bridge", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  const spawn = vi.fn(() =>
    makeFakeChild([
      JSON.stringify({ type: "done", durationMs: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 }),
    ]),
  ) as unknown as OpenHandsSpawnFn;

  await runOpenHandsTurn(
    {
      projectId: "project-1",
      sessionId: "session-1",
      resumeSession: false,
      prompt: "hello",
      turnId: "turn-1",
      modelId: "openrouter:qwen/qwen3-coder:free",
      librarySnapshotPath: "/workspace/project/.openhands/session/session-1/snapshot.json",
      onEvent: () => {},
    },
    { spawn },
  );

  const mockFn = spawn as unknown as ReturnType<typeof vi.fn>;
  const [, argv, options] = mockFn.mock.calls[0] as [
    string,
    string[],
    { env?: NodeJS.ProcessEnv },
  ];
  expect(argv).toContain("--library-snapshot");
  expect(argv).toContain("/workspace/project/.openhands/session/session-1/snapshot.json");
  expect(options.env).toMatchObject({
    OPENHANDS_LIBRARY_SNAPSHOT_PATH: "/workspace/project/.openhands/session/session-1/snapshot.json",
  });
});
```

- [ ] **Step 2: Run runner test to verify it fails**

Run: `pnpm -F @wbd/broker test -- openhands-runner.test.ts`

Expected: FAIL because `librarySnapshotPath` is not part of `AgentTurnOptions`.

- [ ] **Step 3: Add the option to provider types**

In `container/sandbox/broker/src/agent-provider.ts`, add:

```ts
export interface AgentTurnOptions {
  projectId: string;
  sessionId: string;
  resumeSession: boolean;
  prompt: string;
  turnId: string;
  modelId?: string | null;
  librarySnapshotPath?: string;
  onEvent: (event: BrokerToHost) => void;
  signal?: AbortSignal;
}
```

- [ ] **Step 4: Update OpenHands runner**

In `container/sandbox/broker/src/openhands-runner.ts`, extend `bridgeEnv`:

```ts
function bridgeEnv(
  model: string,
  librarySnapshotPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    LLM_MODEL: model,
    LLM_API_KEY: env.LLM_API_KEY || env.OPENROUTER_API_KEY || "",
    LLM_BASE_URL: env.LLM_BASE_URL || env.OPENHANDS_BASE_URL || "https://openrouter.ai/api/v1",
    OPENHANDS_MAX_ITERATIONS: env.OPENHANDS_MAX_ITERATIONS || "30",
    OPENHANDS_ENABLE_PUBLIC_SKILLS: env.OPENHANDS_ENABLE_PUBLIC_SKILLS || "0",
    ...(librarySnapshotPath ? { OPENHANDS_LIBRARY_SNAPSHOT_PATH: librarySnapshotPath } : {}),
  };
}
```

Extend `spawnBridge` args and argv:

```ts
const argv = [
  OPENHANDS_BRIDGE_PATH,
  "--session",
  args.sessionId,
  "--workspace",
  "/workspace/project",
  "--model",
  args.model,
  "--prompt",
  args.prompt,
  ...(args.librarySnapshotPath ? ["--library-snapshot", args.librarySnapshotPath] : []),
];
```

- [ ] **Step 5: Run runner tests**

Run: `pnpm -F @wbd/broker test -- openhands-runner.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add container/sandbox/broker/src/agent-provider.ts container/sandbox/broker/src/openhands-runner.ts container/sandbox/broker/tests/openhands-runner.test.ts
git commit -m "feat: pass library snapshot to openhands"
```

---

### Task 8: Render Snapshot Skills And Agents In The Python Bridge

**Files:**
- Modify: `container/sandbox/broker/python/openhands_bridge.py`
- Create: `container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py`

- [ ] **Step 1: Add Python tests for snapshot rendering helpers**

Create `container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py`:

```py
import json
import tempfile
import unittest
from pathlib import Path

from openhands_bridge import load_library_snapshot, render_library_snapshot


class SnapshotRenderingTest(unittest.TestCase):
    def test_renders_enabled_skills_to_session_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshot_path = root / "snapshot.json"
            snapshot_path.write_text(json.dumps({
                "schemaVersion": 1,
                "skills": [{
                    "slug": "nextjs-seo",
                    "name": "Next.js SEO",
                    "content": "# Body\nUse metadata.",
                    "config": {
                        "description": "SEO skill",
                        "triggers": ["seo", "metadata"],
                        "allowDynamicCommands": False,
                    },
                }],
                "agents": [],
                "tools": ["TerminalTool"],
            }))

            snapshot = load_library_snapshot(snapshot_path)
            rendered = render_library_snapshot(snapshot, root / "rendered")

            skill_file = rendered / "skills" / "nextjs-seo" / "SKILL.md"
            self.assertTrue(skill_file.exists())
            text = skill_file.read_text()
            self.assertIn("name: nextjs-seo", text)
            self.assertIn("triggers:", text)
            self.assertIn("# Body", text)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run Python tests to verify they fail**

Run:

```bash
PYTHONPATH=container/sandbox/broker/python python3 -m unittest container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py
```

Expected: FAIL because `load_library_snapshot` and `render_library_snapshot` do not exist.

- [ ] **Step 3: Implement snapshot helpers**

In `container/sandbox/broker/python/openhands_bridge.py`, add:

```py
def load_library_snapshot(path: Path | str | None) -> dict[str, Any] | None:
    if not path:
        return None
    snapshot_path = Path(path)
    if not snapshot_path.is_file():
        return None
    value = json.loads(snapshot_path.read_text())
    return value if isinstance(value, dict) else None


def _yaml_value(value: str) -> str:
    if all(ch.isalnum() or ch in " _./:-" for ch in value):
        return value
    return json.dumps(value)


def render_library_snapshot(snapshot: dict[str, Any] | None, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    if not snapshot:
        return output_dir

    skills_dir = output_dir / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    for skill in snapshot.get("skills", []):
        if not isinstance(skill, dict):
            continue
        slug = str(skill.get("slug") or "").strip()
        if not slug:
            continue
        config = skill.get("config") if isinstance(skill.get("config"), dict) else {}
        triggers = config.get("triggers") if isinstance(config.get("triggers"), list) else []
        skill_dir = skills_dir / slug
        skill_dir.mkdir(parents=True, exist_ok=True)
        frontmatter = [
            "---",
            f"name: {_yaml_value(slug)}",
            f"description: {_yaml_value(str(config.get('description') or skill.get('name') or slug))}",
        ]
        if triggers:
            frontmatter.append("triggers:")
            frontmatter.extend(f"  - {_yaml_value(str(trigger))}" for trigger in triggers if isinstance(trigger, str))
        frontmatter.extend(["---", "", str(skill.get("content") or "").strip(), ""])
        (skill_dir / "SKILL.md").write_text("\n".join(frontmatter))

    agents_dir = output_dir / "agents"
    agents_dir.mkdir(parents=True, exist_ok=True)
    for agent in snapshot.get("agents", []):
        if not isinstance(agent, dict):
            continue
        slug = str(agent.get("slug") or "").strip()
        if slug:
            (agents_dir / f"{slug}.md").write_text(str(agent.get("content") or "").strip() + "\n")

    return output_dir
```

- [ ] **Step 4: Extend CLI args and context loading**

Add to `parse_args()`:

```py
parser.add_argument("--library-snapshot", default=os.getenv("OPENHANDS_LIBRARY_SNAPSHOT_PATH"))
```

In `main()`, before `agent = build_agent(...)`, render the snapshot:

```py
snapshot = load_library_snapshot(args.library_snapshot)
snapshot_root = render_library_snapshot(
    snapshot,
    workspace / ".openhands" / "session" / args.session,
)
```

Change `build_agent(mod, llm, workspace)` to `build_agent(mod, llm, workspace, snapshot_root)` and change `load_agent_context` to load snapshot skills before project-local skills:

```py
def load_agent_context(mod: SimpleNamespace, workspace: Path, snapshot_root: Path | None = None) -> Any | None:
    skills: list[Any] = []
    snapshot_skills = snapshot_root / "skills" if snapshot_root else None
    if snapshot_skills and snapshot_skills.is_dir() and mod.load_skills_from_dir is not None:
        loaded = mod.load_skills_from_dir(str(snapshot_skills))
        if isinstance(loaded, tuple):
            for group in loaded:
                append_skills(skills, group)
        else:
            append_skills(skills, loaded)
```

- [ ] **Step 5: Run Python tests**

Run:

```bash
PYTHONPATH=container/sandbox/broker/python python3 -m unittest container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py
```

Expected: PASS.

- [ ] **Step 6: Run broker tests**

Run: `pnpm -F @wbd/broker test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add container/sandbox/broker/python/openhands_bridge.py container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py
git commit -m "feat: render openhands library snapshots"
```

---

### Task 9: Add Library UI

**Files:**
- Create: `components/library/LibraryList.tsx`
- Create: `components/library/LibraryEditor.tsx`
- Create: `components/library/PresetPicker.tsx`
- Create: `app/library/page.tsx`

- [ ] **Step 1: Create the library list component**

Create `components/library/LibraryList.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LibraryListItem = {
  id: string;
  type: "SKILL" | "AGENT" | "WORKFLOW_PRESET";
  slug: string;
  name: string;
  description: string;
  tags: string[];
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
};

export function LibraryList(props: {
  items: LibraryListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.items;
    return props.items.filter((item) =>
      [item.name, item.slug, item.description, item.type, item.status, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [props.items, query]);

  return (
    <section className="space-y-3">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search library" />
      <div className="divide-y rounded-md border">
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onSelect(item.id)}
            className={`block w-full px-3 py-2 text-left ${props.selectedId === item.id ? "bg-muted" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{item.name}</span>
              <Badge variant="secondary">{item.type}</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description || item.slug}</p>
          </button>
        ))}
        {filtered.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">No library items found.</p> : null}
      </div>
      <Button type="button">New item</Button>
    </section>
  );
}
```

- [ ] **Step 2: Create editor and preset picker shells**

Create `components/library/LibraryEditor.tsx`:

```tsx
"use client";

import { Textarea } from "@/components/ui/textarea";

export function LibraryEditor(props: {
  name: string;
  content: string;
  onContentChange: (content: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{props.name}</h2>
      <Textarea
        value={props.content}
        onChange={(event) => props.onContentChange(event.target.value)}
        className="min-h-[420px] font-mono text-sm"
      />
    </section>
  );
}
```

Create `components/library/PresetPicker.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export type PresetOption = {
  id: string;
  name: string;
  description: string;
};

export function PresetPicker(props: {
  presets: PresetOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          variant={props.selectedId === preset.id ? "default" : "outline"}
          onClick={() => props.onSelect(preset.id)}
          title={preset.description}
        >
          {preset.name}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create the library page**

Create `app/library/page.tsx`:

```tsx
import { prisma } from "@/lib/db/client";
import { LibraryList } from "@/components/library/LibraryList";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export default async function LibraryPage() {
  const items = await prisma.libraryItem.findMany({
    where: { userId: DEV_USER_ID },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
  });

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-6 md:grid-cols-[360px_1fr]">
      <LibraryList items={items} selectedId={items[0]?.id ?? null} onSelect={() => {}} />
      <section className="rounded-md border p-4">
        <h1 className="text-xl font-semibold">Global OpenHands Library</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Select a skill, agent, or workflow preset to edit revisions and session behavior.
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run typecheck/build**

Run: `pnpm build`

Expected: build succeeds. If `onSelect={() => {}}` in a server component causes a client boundary error, move the page body into a small client component `components/library/LibraryClient.tsx` and pass serialized `items`.

- [ ] **Step 5: Commit**

```bash
git add app/library/page.tsx components/library
git commit -m "feat: add library management ui"
```

---

### Task 10: Add Preset Selection To OpenHands Sessions

**Files:**
- Modify: `app/project/[id]/page.tsx`

- [ ] **Step 1: Add client state for selected preset**

In `app/project/[id]/page.tsx`, add:

```ts
const [libraryPresets, setLibraryPresets] = useState<Array<{ id: string; name: string; description: string }>>([]);
const [selectedLibraryPresetId, setSelectedLibraryPresetId] = useState<string | null>(null);
```

- [ ] **Step 2: Fetch workflow presets**

Add an effect:

```ts
useEffect(() => {
  if (runtime !== "openhands") return;
  let cancelled = false;
  fetch("/api/library?type=WORKFLOW_PRESET")
    .then((response) => response.ok ? response.json() : { items: [] })
    .then((body) => {
      if (!cancelled) setLibraryPresets(body.items ?? []);
    })
    .catch(() => {
      if (!cancelled) setLibraryPresets([]);
    });
  return () => {
    cancelled = true;
  };
}, [runtime]);
```

- [ ] **Step 3: Render `PresetPicker` near the model/runtime controls**

Import `PresetPicker` and render only for OpenHands:

```tsx
{runtime === "openhands" && libraryPresets.length > 0 ? (
  <PresetPicker
    presets={libraryPresets}
    selectedId={selectedLibraryPresetId}
    onSelect={setSelectedLibraryPresetId}
  />
) : null}
```

- [ ] **Step 4: Include preset in runtime state sync**

Extend `syncRuntimeState` to accept `libraryPresetItemId?: string | null` and include it in the PATCH body:

```ts
runtimeState: {
  runtime,
  providerSessionId,
  ...(modelId ? { modelId } : {}),
  ...(libraryPresetItemId ? { libraryPresetItemId } : {}),
}
```

When sending an OpenHands turn, pass `selectedLibraryPresetId` into `syncRuntimeState`.

- [ ] **Step 5: Run build**

Run: `pnpm build`

Expected: build succeeds and the project page compiles.

- [ ] **Step 6: Commit**

```bash
git add app/project/[id]/page.tsx
git commit -m "feat: select library presets for sessions"
```

---

### Task 11: Document And Verify The End-To-End Flow

**Files:**
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md`

- [ ] **Step 1: Update docs**

Add a section under `openhands`:

```md
### Global Library Snapshots

OpenHands sessions can use a global personal library managed in the app database.
Skills, agents, and workflow presets are versioned as immutable revisions.
When a preset is selected for a session, the host resolves it into a
`SessionLibrarySnapshot` tied to the session's `SessionRuntimeState`.

The broker passes the snapshot path to `openhands_bridge.py`, which renders
session-scoped OpenHands files under `.openhands/session/<sessionId>/`.
Old sessions keep their snapshot until the user explicitly updates them.
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm test:host -- lib/library
pnpm -F @wbd/broker test -- openhands-runner.test.ts
PYTHONPATH=container/sandbox/broker/python python3 -m unittest container/sandbox/broker/python/tests/test_openhands_bridge_snapshot.py
```

Expected: all focused tests pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm test:host
pnpm -F @wbd/broker test
pnpm build
```

Expected: all commands exit `0`.

- [ ] **Step 4: Commit**

```bash
git add docs/AGENT_RUNTIME_OPTIONS.md
git commit -m "docs: document openhands library snapshots"
```

---

## Self-Review

Spec coverage:

- DB-managed global library: Tasks 1, 3, 5, 9.
- Immutable revisions, diff, rollback: Tasks 3 and 5.
- Presets with skills, agents, tools, model, runtime: Tasks 3, 6, 10.
- Session snapshots as default: Tasks 3, 6, 7, 8.
- OpenHands bridge loading snapshot files: Tasks 7 and 8.
- Deterministic import/export: Task 4 and Task 5 endpoints.
- Internal version history and rollback: Tasks 1, 3, 5.
- Remote Agent Server preserved for later: Task 3 config and docs in Task 11.

Known implementation risks:

- The first UI shell may need a `LibraryClient.tsx` wrapper because server components cannot pass event handlers to client children.
- OpenHands file-based agent support may vary by SDK version. Task 8 intentionally renders agent files and keeps fallback support in the bridge.
- Route tests that touch Prisma require the test database to have the new migration applied before running.

No placeholders intentionally remain; implementation tasks include exact paths, commands, and expected outcomes.
