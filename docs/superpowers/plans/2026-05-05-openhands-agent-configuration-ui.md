# OpenHands Agent Configuration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build global and project-level UI management for OpenHands `AGENTS.md`, `.agents/skills`, and `.agents/agents`, including enable/disable controls and effective configuration preview.

**Architecture:** Store global defaults, reusable skills, reusable file-based agents, project override modes, and enablement states in Prisma. Resolve an effective OpenHands config per project, then materialize it into the live sandbox as `AGENTS.md`, `.agents/skills/<name>/SKILL.md`, and `.agents/agents/<name>.md`; on restart/spawn, pass the same effective config through base64 env so the sandbox boot path is deterministic. Keep deprecated `.openhands/*` readable only as legacy project files and prefer `.agents/*` for all new writes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Postgres, existing broker WebSocket file protocol, OpenHands SDK conventions, Vitest.

---

## File Structure

- Create `lib/agent-config/defaults.ts`: default global `AGENTS.md` content, default skill/agent templates, shared constants for OpenHands paths.
- Create `lib/agent-config/types.ts`: TypeScript DTOs and enums used by API routes and UI.
- Create `lib/agent-config/resolve.ts`: pure resolver that combines global defaults, project overrides, and enablement records into an effective config.
- Create `lib/agent-config/materialize.ts`: converts effective config into a list of sandbox file writes.
- Create `lib/agent-config/validation.ts`: small validators for names, markdown size, frontmatter-safe fields, and enablement states.
- Create `lib/agent-config/__tests__/resolve.test.ts`: resolver coverage.
- Create `lib/agent-config/__tests__/materialize.test.ts`: generated file path/content coverage.
- Modify `prisma/schema.prisma`: add agent config tables.
- Create migration under `prisma/migrations/20260505120000_add_agent_configuration/`.
- Create `app/api/agent-config/route.ts`: global config GET/PUT.
- Create `app/api/agent-config/skills/route.ts`: global skill list/create/update.
- Create `app/api/agent-config/agents/route.ts`: global agent list/create/update.
- Create `app/api/projects/[id]/agent-config/route.ts`: project effective config GET/PUT.
- Modify `app/api/projects/[id]/route.ts` and `app/api/projects/[id]/restart/route.ts`: pass effective config to sandbox spawn/restart.
- Modify `lib/runtime/types.ts`, `lib/runtime/daytona/cloud.ts`, `lib/runtime/daytona/fake.ts`, `lib/runtime/worker-pool/runtime.ts`: carry effective config through runtime spawn args.
- Modify `container/sandbox/entrypoint.sh`: write effective OpenHands files from env before dependency install.
- Modify `container/sandbox/broker/python/openhands_bridge.py`: load `.agents/skills` before legacy `.openhands/skills`.
- Modify `app/project/[id]/page.tsx`: add project-level Agent Config panel and live sandbox sync.
- Create `app/agent-config/page.tsx`: global control plane.
- Create `components/agent-config/*`: focused UI components for inheritance stack, instruction editor, skills table, agents table, effective preview.
- Modify `docs/AGENT_RUNTIME_OPTIONS.md`: document managed `.agents` behavior.

## Data Model

Add these Prisma models. Exact field names are used by later tasks.

```prisma
model WorkspaceAgentConfig {
  id              String   @id @default("global")
  agentsMd        String   @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ProjectAgentConfig {
  projectId       String                 @id
  project         Project                @relation(fields: [projectId], references: [id], onDelete: Cascade)
  agentsMode      AgentConfigMode        @default(EXTEND)
  agentsMd        String                 @default("") @db.Text
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt
}

model AgentSkillDefinition {
  id              String   @id @default(cuid())
  name            String   @unique
  description     String   @default("")
  body            String   @db.Text
  triggers        Json?
  source          AgentConfigSource @default(WORKSPACE)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  enablements     AgentSkillEnablement[]
}

model AgentDefinition {
  id              String   @id @default(cuid())
  name            String   @unique
  description     String   @default("")
  body            String   @db.Text
  tools           Json?
  model           String   @default("inherit")
  skillNames      Json?
  permissionMode  String?
  source          AgentConfigSource @default(WORKSPACE)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  enablements     AgentDefinitionEnablement[]
}

model AgentSkillEnablement {
  id              String       @id @default(cuid())
  skillId         String
  skill           AgentSkillDefinition @relation(fields: [skillId], references: [id], onDelete: Cascade)
  projectId       String?
  project         Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  state           EnablementState
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@unique([skillId, projectId])
  @@index([projectId])
}

model AgentDefinitionEnablement {
  id              String       @id @default(cuid())
  agentId         String
  agent           AgentDefinition @relation(fields: [agentId], references: [id], onDelete: Cascade)
  projectId       String?
  project         Project?     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  state           EnablementState
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@unique([agentId, projectId])
  @@index([projectId])
}

enum AgentConfigMode {
  INHERIT
  EXTEND
  REPLACE
}

enum AgentConfigSource {
  WORKSPACE
  PROJECT
  LEGACY_FILE
}

enum EnablementState {
  ENABLED
  DISABLED
  INHERITED
}
```

Also add these relations to `Project`:

```prisma
agentConfig        ProjectAgentConfig?
skillEnablements  AgentSkillEnablement[]
agentEnablements  AgentDefinitionEnablement[]
```

---

### Task 1: Add Agent Config Domain Model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260505120000_add_agent_configuration/migration.sql`
- Create: `lib/agent-config/types.ts`
- Create: `lib/agent-config/defaults.ts`

- [ ] **Step 1: Update Prisma schema**

Add the models and enums from the Data Model section. Keep relation names simple and avoid optional JSON parsing in Prisma itself.

- [ ] **Step 2: Generate migration**

Run:

```bash
pnpm prisma migrate dev --name add_agent_configuration
```

Expected: Prisma creates a migration with the new tables/enums and regenerates the client. If the local DB is unavailable, create the SQL migration manually and record the blocker in the task file.

- [ ] **Step 3: Add shared types**

Create `lib/agent-config/types.ts`:

```ts
export type AgentConfigMode = "INHERIT" | "EXTEND" | "REPLACE";
export type EnablementState = "ENABLED" | "DISABLED" | "INHERITED";

export interface SkillConfigDto {
  id: string;
  name: string;
  description: string;
  body: string;
  triggers: string[];
  workspaceState: EnablementState;
  projectState?: EnablementState;
}

export interface FileAgentConfigDto {
  id: string;
  name: string;
  description: string;
  body: string;
  tools: string[];
  model: string;
  skillNames: string[];
  permissionMode: string | null;
  workspaceState: EnablementState;
  projectState?: EnablementState;
}

export interface EffectiveAgentConfig {
  agentsMd: string;
  agentsMode: AgentConfigMode;
  skills: Array<{
    name: string;
    description: string;
    body: string;
    triggers: string[];
    enabled: boolean;
    source: "WORKSPACE" | "PROJECT" | "LEGACY_FILE";
  }>;
  agents: Array<{
    name: string;
    description: string;
    body: string;
    tools: string[];
    model: string;
    skillNames: string[];
    permissionMode: string | null;
    enabled: boolean;
    source: "WORKSPACE" | "PROJECT" | "LEGACY_FILE";
  }>;
}
```

- [ ] **Step 4: Add defaults**

Create `lib/agent-config/defaults.ts`:

```ts
export const OPENHANDS_AGENTS_MD_PATH = "AGENTS.md";
export const OPENHANDS_SKILLS_DIR = ".agents/skills";
export const OPENHANDS_AGENTS_DIR = ".agents/agents";
export const LEGACY_OPENHANDS_SKILLS_DIR = ".openhands/skills";

export const DEFAULT_WORKSPACE_AGENTS_MD = `# AGENTS.md

## General Behavior

- Keep changes small, focused, and maintainable.
- Prefer the existing project architecture and local abstractions.
- Preserve correct native spelling, including umlauts such as ä, ö, ü, and ß.

## OpenHands Runtime

- This project is edited from /workspace/project.
- Use AGENTS.md for always-on project context.
- Use .agents/skills/<name>/SKILL.md for optional skills.
- Use .agents/agents/<name>.md for file-based sub-agents.
`;
```

- [ ] **Step 5: Verify schema/type generation**

Run:

```bash
pnpm prisma generate
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/agent-config/types.ts lib/agent-config/defaults.ts
git commit -m "feat: add OpenHands agent config model for T-20260505-004"
```

---

### Task 2: Implement Effective Config Resolver

**Files:**
- Create: `lib/agent-config/resolve.ts`
- Create: `lib/agent-config/materialize.ts`
- Create: `lib/agent-config/validation.ts`
- Create: `lib/agent-config/__tests__/resolve.test.ts`
- Create: `lib/agent-config/__tests__/materialize.test.ts`

- [ ] **Step 1: Write resolver tests**

Create `lib/agent-config/__tests__/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveEffectiveAgentConfig } from "../resolve";

describe("resolveEffectiveAgentConfig", () => {
  it("extends global AGENTS.md with project content", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "# Global\n",
      projectConfig: { agentsMode: "EXTEND", agentsMd: "## Project\n" },
      skills: [],
      agents: [],
    });

    expect(got.agentsMd).toBe("# Global\n\n## Project\n");
    expect(got.agentsMode).toBe("EXTEND");
  });

  it("replaces global AGENTS.md when project mode is replace", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "# Global\n",
      projectConfig: { agentsMode: "REPLACE", agentsMd: "# Project\n" },
      skills: [],
      agents: [],
    });

    expect(got.agentsMd).toBe("# Project\n");
  });

  it("disables a globally enabled skill for one project", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "",
      projectConfig: { agentsMode: "INHERIT", agentsMd: "" },
      skills: [{
        id: "s1",
        name: "copywriting",
        description: "Copywriting help",
        body: "Write better copy.",
        triggers: ["copy"],
        workspaceState: "ENABLED",
        projectState: "DISABLED",
      }],
      agents: [],
    });

    expect(got.skills).toEqual([
      expect.objectContaining({ name: "copywriting", enabled: false }),
    ]);
  });
});
```

- [ ] **Step 2: Implement resolver**

Create `lib/agent-config/resolve.ts`:

```ts
import type {
  EffectiveAgentConfig,
  EnablementState,
  FileAgentConfigDto,
  SkillConfigDto,
} from "./types";

interface ResolveArgs {
  workspaceAgentsMd: string;
  projectConfig: {
    agentsMode: "INHERIT" | "EXTEND" | "REPLACE";
    agentsMd: string;
  };
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}

function enabled(workspaceState: EnablementState, projectState?: EnablementState): boolean {
  const state = projectState && projectState !== "INHERITED" ? projectState : workspaceState;
  return state === "ENABLED";
}

function mergeAgentsMd(workspaceAgentsMd: string, projectMode: ResolveArgs["projectConfig"]["agentsMode"], projectAgentsMd: string): string {
  if (projectMode === "REPLACE") return projectAgentsMd;
  if (projectMode === "INHERIT" || !projectAgentsMd.trim()) return workspaceAgentsMd;
  return `${workspaceAgentsMd.trimEnd()}\n\n${projectAgentsMd.trimStart()}`;
}

export function resolveEffectiveAgentConfig(args: ResolveArgs): EffectiveAgentConfig {
  return {
    agentsMode: args.projectConfig.agentsMode,
    agentsMd: mergeAgentsMd(
      args.workspaceAgentsMd,
      args.projectConfig.agentsMode,
      args.projectConfig.agentsMd,
    ),
    skills: args.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      triggers: skill.triggers,
      enabled: enabled(skill.workspaceState, skill.projectState),
      source: "WORKSPACE",
    })),
    agents: args.agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      body: agent.body,
      tools: agent.tools,
      model: agent.model,
      skillNames: agent.skillNames,
      permissionMode: agent.permissionMode,
      enabled: enabled(agent.workspaceState, agent.projectState),
      source: "WORKSPACE",
    })),
  };
}
```

- [ ] **Step 3: Write materialization tests**

Create `lib/agent-config/__tests__/materialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { materializeOpenHandsFiles } from "../materialize";

describe("materializeOpenHandsFiles", () => {
  it("writes AGENTS.md plus enabled skills and agents", () => {
    const files = materializeOpenHandsFiles({
      agentsMode: "EXTEND",
      agentsMd: "# Rules\n",
      skills: [{
        name: "seo",
        description: "SEO guidance",
        body: "Use semantic HTML.",
        triggers: ["seo"],
        enabled: true,
        source: "WORKSPACE",
      }],
      agents: [{
        name: "reviewer",
        description: "Reviews code.",
        body: "Review only.",
        tools: ["terminal"],
        model: "inherit",
        skillNames: ["seo"],
        permissionMode: null,
        enabled: true,
        source: "WORKSPACE",
      }],
    });

    expect(files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      ".agents/skills/seo/SKILL.md",
      ".agents/agents/reviewer.md",
    ]);
    expect(files[1]?.content).toContain("name: seo");
    expect(files[2]?.content).toContain("tools:");
  });
});
```

- [ ] **Step 4: Implement materialization**

Create `lib/agent-config/materialize.ts`:

```ts
import {
  OPENHANDS_AGENTS_DIR,
  OPENHANDS_AGENTS_MD_PATH,
  OPENHANDS_SKILLS_DIR,
} from "./defaults";
import type { EffectiveAgentConfig } from "./types";

interface MaterializedFile {
  path: string;
  content: string;
}

function yamlList(values: string[]): string {
  return values.length === 0 ? "[]" : `\n${values.map((value) => `  - ${JSON.stringify(value)}`).join("\n")}`;
}

function skillContent(skill: EffectiveAgentConfig["skills"][number]): string {
  return `---
name: ${skill.name}
description: ${JSON.stringify(skill.description)}
triggers:${yamlList(skill.triggers)}
---

${skill.body.trim()}
`;
}

function agentContent(agent: EffectiveAgentConfig["agents"][number]): string {
  const permissionLine = agent.permissionMode ? `permission_mode: ${agent.permissionMode}\n` : "";
  return `---
name: ${agent.name}
description: ${JSON.stringify(agent.description)}
tools:${yamlList(agent.tools)}
model: ${JSON.stringify(agent.model)}
skills:${yamlList(agent.skillNames)}
${permissionLine}---

${agent.body.trim()}
`;
}

export function materializeOpenHandsFiles(config: EffectiveAgentConfig): MaterializedFile[] {
  return [
    { path: OPENHANDS_AGENTS_MD_PATH, content: config.agentsMd },
    ...config.skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        path: `${OPENHANDS_SKILLS_DIR}/${skill.name}/SKILL.md`,
        content: skillContent(skill),
      })),
    ...config.agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        path: `${OPENHANDS_AGENTS_DIR}/${agent.name}.md`,
        content: agentContent(agent),
      })),
  ];
}
```

- [ ] **Step 5: Add validation**

Create `lib/agent-config/validation.ts`:

```ts
const MAX_MARKDOWN_BYTES = 128 * 1024;
const SAFE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertSafeAgentConfigName(name: string): void {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error("Name must use lowercase letters, numbers, and hyphens.");
  }
}

export function assertMarkdownSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new Error("Markdown content is too large.");
  }
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
pnpm test:host -- lib/agent-config
```

Expected: resolver and materialization tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/agent-config
git commit -m "feat: resolve OpenHands effective agent config for T-20260505-004"
```

---

### Task 3: Add Global And Project APIs

**Files:**
- Create: `app/api/agent-config/route.ts`
- Create: `app/api/agent-config/skills/route.ts`
- Create: `app/api/agent-config/agents/route.ts`
- Create: `app/api/projects/[id]/agent-config/route.ts`
- Create: `app/api/agent-config/__tests__/route.test.ts`
- Create: `app/api/projects/[id]/agent-config/__tests__/route.test.ts`

- [ ] **Step 1: Write API tests**

Add tests that mirror existing owned project route tests:

```ts
it("returns effective project agent config for the owner", async () => {
  const res = await GET(new Request("http://localhost/api/projects/p1/agent-config"), {
    params: Promise.resolve({ id: "p1" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.effective.agentsMd).toContain("AGENTS.md");
});
```

Also test:

- unauthenticated requests return 401
- non-owned project returns 404
- invalid skill name returns 400
- project `agentsMode` accepts only `INHERIT`, `EXTEND`, `REPLACE`

- [ ] **Step 2: Implement global GET/PUT**

`GET /api/agent-config` returns:

```ts
{
  agentsMd: string;
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}
```

`PUT /api/agent-config` updates `WorkspaceAgentConfig.agentsMd`.

- [ ] **Step 3: Implement skill and agent mutation routes**

Use `assertSafeAgentConfigName()` and `assertMarkdownSize()` before writes. Keep create/update as upserts keyed by `name`.

- [ ] **Step 4: Implement project route**

`GET /api/projects/[id]/agent-config` returns:

```ts
{
  project: { id: string; name: string };
  projectConfig: { agentsMode: AgentConfigMode; agentsMd: string };
  effective: EffectiveAgentConfig;
  materializedFiles: Array<{ path: string; content: string }>;
}
```

`PUT /api/projects/[id]/agent-config` updates project mode, project `agentsMd`, and project skill/agent enablement overrides.

- [ ] **Step 5: Verify API tests**

Run:

```bash
pnpm test:host -- app/api/agent-config "app/api/projects/[id]/agent-config"
```

Expected: new API route tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/agent-config "app/api/projects/[id]/agent-config" lib/agent-config
git commit -m "feat: expose OpenHands agent config APIs for T-20260505-004"
```

---

### Task 4: Materialize Config Into Sandbox Runtime

**Files:**
- Modify: `lib/runtime/types.ts`
- Modify: `lib/runtime/worker-pool/runtime.ts`
- Modify: `lib/runtime/daytona/cloud.ts`
- Modify: `lib/runtime/daytona/fake.ts`
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/projects/[id]/restart/route.ts`
- Modify: `container/sandbox/entrypoint.sh`
- Add or modify focused tests in runtime and route test files.

- [ ] **Step 1: Add runtime type field**

In `lib/runtime/types.ts`, extend `SpawnArgs` with:

```ts
openhandsFiles?: Array<{
  path: string;
  content: string;
}>;
```

- [ ] **Step 2: Write worker-pool test**

Add a test that spawns with `openhandsFiles` and asserts the worker-agent request env includes `OPENHANDS_FILES_B64`.

- [ ] **Step 3: Encode files in worker-pool runtime**

In `lib/runtime/worker-pool/runtime.ts`, add:

```ts
if (spawn.openhandsFiles && spawn.openhandsFiles.length > 0) {
  env.OPENHANDS_FILES_B64 = Buffer.from(JSON.stringify(spawn.openhandsFiles), "utf8").toString("base64");
}
```

- [ ] **Step 4: Add Daytona env support**

In `lib/runtime/daytona/cloud.ts`, include the same `OPENHANDS_FILES_B64` encoding when `args.openhandsFiles` exists. In fake runtime, write the files into the fake project root so tests can inspect them.

- [ ] **Step 5: Resolve config in project creation/restart**

Before `runtime.spawnProjectSandbox()`, load effective config via a helper in `lib/agent-config/db.ts`:

```ts
const openhandsFiles = materializeOpenHandsFiles(await loadEffectiveAgentConfig(project.id));
```

Pass `openhandsFiles` to spawn.

- [ ] **Step 6: Write sandbox entrypoint script logic**

In `container/sandbox/entrypoint.sh`, after `.env` write and before `install_project_deps`, add:

```sh
if [ -n "${OPENHANDS_FILES_B64:-}" ]; then
  echo "[entrypoint] writing managed OpenHands config files"
  OPENHANDS_TMP="/tmp/openhands-files.json"
  printf '%s' "${OPENHANDS_FILES_B64}" | base64 -d > "${OPENHANDS_TMP}"
  python3 - <<'PY'
import json
from pathlib import Path

root = Path("/workspace/project").resolve()
items = json.loads(Path("/tmp/openhands-files.json").read_text())
for item in items:
    rel = item["path"]
    target = (root / rel).resolve()
    if root not in target.parents and target != root:
        raise SystemExit(f"refusing path outside workspace: {rel}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(item["content"], encoding="utf-8")
PY
fi
```

- [ ] **Step 7: Verify runtime tests**

Run:

```bash
pnpm test:host -- lib/runtime app/api/projects
```

Expected: focused runtime and project route tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/runtime app/api/projects container/sandbox/entrypoint.sh
git commit -m "feat: materialize OpenHands config into sandboxes for T-20260505-004"
```

---

### Task 5: Fix OpenHands Bridge Skill Loading

**Files:**
- Modify: `container/sandbox/broker/python/openhands_bridge.py`
- Modify: `container/sandbox/broker/python/tests/test_openhands_bridge.py`

- [ ] **Step 1: Write Python test**

Add a test that creates both `.agents/skills/modern/SKILL.md` and `.openhands/skills/legacy.md`, invokes `load_agent_context()` with fake loader functions, and asserts the modern path is visited before legacy.

- [ ] **Step 2: Update bridge loader**

Replace the single `workspace / ".openhands" / "skills"` lookup with:

```py
skill_dirs = [
    workspace / ".agents" / "skills",
    workspace / ".openhands" / "skills",
]
for local_skills in skill_dirs:
    if local_skills.is_dir() and mod.load_skills_from_dir is not None:
        try:
            loaded = mod.load_skills_from_dir(str(local_skills))
            if isinstance(loaded, tuple):
                for group in loaded:
                    append_skills(skills, group)
            else:
                append_skills(skills, loaded)
        except Exception:
            pass
```

- [ ] **Step 3: Verify bridge tests**

Run:

```bash
pnpm test:host -- container/sandbox/broker/python/tests/test_openhands_bridge.py container/sandbox/broker/tests/openhands-runner.test.ts
```

Expected: Python bridge and OpenHands runner tests pass.

- [ ] **Step 4: Commit**

```bash
git add container/sandbox/broker/python/openhands_bridge.py container/sandbox/broker/python/tests/test_openhands_bridge.py
git commit -m "fix: load OpenHands .agents skills first for T-20260505-004"
```

---

### Task 6: Build Global Agent Config UI

**Files:**
- Create: `app/agent-config/page.tsx`
- Create: `components/agent-config/AgentConfigShell.tsx`
- Create: `components/agent-config/AgentsMdEditor.tsx`
- Create: `components/agent-config/SkillsTable.tsx`
- Create: `components/agent-config/FileAgentsTable.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Read Next.js docs**

Before editing App Router pages, read the local Next.js docs relevant to App Router pages in `node_modules/next/dist/docs/`.

- [ ] **Step 2: Implement global page**

Create a client component page that fetches `/api/agent-config`, shows tabs for `AGENTS.md`, `Skills`, and `Agents`, and saves via the new API routes.

Design direction:

- dense operational layout
- inheritance stack header
- no marketing hero
- tables for skills/agents
- side preview for effective markdown/frontmatter

- [ ] **Step 3: Add dashboard navigation**

In `app/page.tsx`, add an outline button beside Usage:

```tsx
<Button asChild variant="outline" size="sm">
  <Link href="/agent-config">
    <Settings2 />
    Agent config
  </Link>
</Button>
```

Import `Settings2` from `lucide-react`.

- [ ] **Step 4: Verify UI compile**

Run:

```bash
pnpm lint
```

Expected: no lint errors.

- [ ] **Step 5: Commit**

```bash
git add app/agent-config app/page.tsx components/agent-config
git commit -m "feat: add global OpenHands agent config UI for T-20260505-004"
```

---

### Task 7: Build Project Overrides UI And Live Sync

**Files:**
- Modify: `app/project/[id]/page.tsx`
- Create: `components/agent-config/InheritanceStack.tsx`
- Create: `components/agent-config/EffectiveConfigPreview.tsx`

- [ ] **Step 1: Add project config state**

In `app/project/[id]/page.tsx`, add state for:

```ts
const [agentConfigOpen, setAgentConfigOpen] = useState(false);
const [agentConfig, setAgentConfig] = useState<ProjectAgentConfigResponse | null>(null);
const [agentConfigError, setAgentConfigError] = useState<string | null>(null);
const [agentConfigSaving, setAgentConfigSaving] = useState(false);
```

- [ ] **Step 2: Add project config loader/saver**

Add functions:

```ts
async function loadAgentConfig(): Promise<void> {
  const res = await fetch(`/api/projects/${id}/agent-config`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  setAgentConfig(await res.json());
}

async function saveAgentConfig(next: ProjectAgentConfigInput): Promise<void> {
  const res = await fetch(`/api/projects/${id}/agent-config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  setAgentConfig(body);
  await syncOpenHandsFiles(body.materializedFiles);
}
```

- [ ] **Step 3: Add live sandbox sync**

Reuse existing `writeProjectFile()` and write all materialized files:

```ts
async function syncOpenHandsFiles(files: Array<{ path: string; content: string }>): Promise<void> {
  for (const file of files) {
    await writeProjectFile(file.path, file.content);
  }
}
```

If a write fails because a turn is running, show a warning that the config will apply after restart.

- [ ] **Step 4: Add UI affordance**

Add an `Agent config` icon button near the existing Env/Restart controls. The project panel should show:

- mode selector: inherit, extend, replace
- project `AGENTS.md` textarea
- effective config preview
- skills/agents toggle lists
- disabled state while an agent turn is active

- [ ] **Step 5: Verify project UI**

Run:

```bash
pnpm lint
```

Expected: no lint errors.

- [ ] **Step 6: Commit**

```bash
git add app/project/[id]/page.tsx components/agent-config
git commit -m "feat: add project OpenHands config overrides for T-20260505-004"
```

---

### Task 8: Documentation And Final Verification

**Files:**
- Modify: `docs/AGENT_RUNTIME_OPTIONS.md`
- Modify: `docs/tasks/active/T-20260505-004.md`
- Modify: `docs/changelog/2026-05.md`

- [ ] **Step 1: Document managed OpenHands config**

In `docs/AGENT_RUNTIME_OPTIONS.md`, add a short section:

```md
### Managed OpenHands Configuration

The host UI stores global and project-level OpenHands configuration in the database and materializes the effective configuration into each sandbox:

- `AGENTS.md` for always-on repository context.
- `.agents/skills/<name>/SKILL.md` for AgentSkills-compatible skills.
- `.agents/agents/<name>.md` for file-based OpenHands sub-agents.

New writes use `.agents/*`. Legacy `.openhands/*` files may still be present in imported repositories, but the UI treats them as legacy project files instead of global defaults.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm test:host -- lib/agent-config app/api/agent-config "app/api/projects/[id]/agent-config" container/sandbox/broker
```

Expected: all focused tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: no lint errors.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: production build succeeds.

- [ ] **Step 5: Close task and changelog**

Move the task file to `docs/tasks/done/2026/05/T-20260505-004.md`, set `Status: Done`, fill `Outcome`, and add one concise changelog entry to `docs/changelog/2026-05.md`.

- [ ] **Step 6: Final commit**

```bash
git add docs/AGENT_RUNTIME_OPTIONS.md docs/tasks docs/changelog/2026-05.md
git commit -m "docs: document OpenHands managed config for T-20260505-004"
```

---

## Sub-Agent Execution Split

Use subagent-driven development with these ownership boundaries:

- **Worker 1, Data/API:** Prisma schema, resolver, materializer, global/project API routes, route tests.
- **Worker 2, Runtime/OpenHands:** runtime spawn payload, entrypoint materialization, bridge `.agents/skills` loading, broker/runtime tests.
- **Worker 3, UI:** global `/agent-config` page, project override panel, shared components, lint/build fixes scoped to UI.
- **Local integration:** review diffs, resolve naming/API mismatches, update docs/task/changelog, run full verification.

Each worker is not alone in the codebase. Workers must not revert unrelated edits, must stay inside their owned files, and must report changed paths plus verification commands.
