# Website-Builder-Daytona — MVP Design Spec

**Date:** 2026-04-22
**Status:** Design, awaiting user review
**Project root:** `/Volumes/Extern/Projekte/website-builder-daytona`

---

## 1. Goal

Build a v0/Lovable-style web application builder where each user project lives in its own Daytona container. Inside that container, a coordinated team of Claude Code and Codex agents generates and iterates on a Next.js 16 application in response to natural-language prompts. The user interacts with the system through a three-panel UI (chat / file-tree+editor / live preview) and can edit code directly; every meaningful change is captured as a git commit, making rollback trivial.

Non-goals for the MVP are documented in section 10.

---

## 2. Chosen Options Summary

| Decision | Chosen Option |
|----------|---------------|
| MVP scope | Multi-agent from day one, full Daytona container per project (Option C from brainstorm) |
| Agent hosting | Agents run **inside** each project's Daytona container |
| Agent topology | Specialised 6-role team (Topology B) with Pipeline hygiene from C |
| UI | Lovable-style: Chat + FileTree + Monaco Editor + Preview iframe |
| Container lifecycle | Lazy spawn + aggressive pause (Strategy A) |
| Multi-tenancy | One Daytona org/workspace per user |
| Container resources | Fixed 2 vCPU / 4 GB RAM / 10 GB disk |
| Host ↔ container protocol | Custom `agent-broker` inside container, WebSocket to host |
| Git storage | Bare git repos in blob/volume storage (no git server) |
| Host database | Self-hosted Postgres (Docker) with Prisma |
| Auth | Better Auth |

---

## 3. Architecture Overview

Three tiers, each with clear boundaries:

```
BROWSER ─── WSS Session Bus ──→ HOST ─── Daytona API + WSS ──→ CONTAINER (one per project)
   │                             │
   │                             ├── Postgres (metadata, chat history, commits)
   │                             └── Blob / Volume (bare git repos)
   │
   └── iframe src → Daytona preview URL (direct to container)
```

### 3.1 Browser

- **Chat panel** — streaming agent output, per-agent status events, token/cost info
- **FileTree** — virtualised list, "dirty" badges for just-changed files
- **Editor** — Monaco with syntax highlighting, read/write, soft-locked during agent turns
- **Preview** — `<iframe>` pointed at the Daytona-exposed preview URL (bypasses host)

Single WebSocket connection to host per active project session. Receives typed events (see §6).

### 3.2 Host (Next.js 16 App)

Responsibilities:
- Auth, user and project management
- Project dashboard (list, open, delete)
- **Session WebSocket proxy** — auth-gates browser connections, multiplexes to the right container's broker, mirrors events into Postgres for persistence/replay
- Daytona lifecycle orchestration (spawn / pause / resume / archive / destroy)
- Git storage: writes bare repos to volume; containers clone/push via tunneled access
- Project-metadata DB (see §7)

The host runs **no LLM calls directly in the MVP**. All agent execution happens inside containers. (Exception kept for future MCP bridge, out of MVP scope.)

### 3.3 Daytona Container (one per project)

Running inside each container:

- **agent-broker** (custom Node.js service, ~300–400 LoC) on port 4000
  - WebSocket server consumed by the host proxy
  - Spawns Claude Code and Codex CLIs as child processes per turn
  - `chokidar` filesystem watcher → streams `file.changed` events
  - Handles git commits after agent turns
- **Claude Code CLI** with project-specific `.claude/` directory (agents, skills, hooks, CLAUDE.md)
- **Codex CLI** (secondary coder / rescue path, GPT-5)
- **User project**: the actual Next.js 16 app being built, with its own git repo
- **`next dev` on port 3000**, exposed via Daytona preview URL

---

## 4. Agent Team (inside container)

Six roles, each with a narrow context to minimise token cost. Modelled as Claude Code sub-agents in `.claude/agents/`, plus Codex as an external CLI invoked by the Orchestrator.

| Agent | Model | Context | Role | Invoked by |
|-------|-------|---------|------|------------|
| **Orchestrator** | Sonnet 4.6 | Full session transcript | Talks to user, delegates, summarises results | Broker (on user prompt) |
| **Planner** | Opus 4.7 | User prompt + short repo summary | Produces structured plan (files to touch, components), exits | Orchestrator |
| **Explorer** | Haiku 4.5 | Empty — tool calls only | grep/glob/read, returns paths and snippets | Orchestrator or Coder |
| **Coder-Claude** | Sonnet 4.6 | Plan + relevant files | Writes/edits code | Orchestrator (default coder) |
| **Coder-Codex** | GPT-5 (Codex CLI) | Same inputs as Coder-Claude | Second opinion / rescue when Claude is stuck | Orchestrator on-demand |
| **Reviewer** | Sonnet 4.6 | Git diff + build output | Runs typecheck, build; produces review note | Broker (auto after coder) |

### 4.1 Pipeline Hygiene

Each turn follows the same ordered stages: **Plan → Code → Review → Commit**. Between stages, structured artefacts (markdown plan, review note) are written to `.agent-artifacts/` inside the project. This gives deterministic debuggability without the rigidity of a fully rigid pipeline: creative ad-hoc tasks (e.g., "make it look nicer") can skip Planner when the Orchestrator judges it unnecessary.

### 4.2 Hard Limits (Cost Control)

- Per agent turn: max 50 tool calls, max 100k input tokens, max 8k output tokens
- Per project per day: soft limit configurable per user tier
- Broker aborts and reports if limits exceeded mid-turn

### 4.3 Serialisation

Claude Code and Codex both mutate the same filesystem. To avoid races, the broker serialises agent processes: only one code-mutating agent runs at a time per container. (Explorer and Reviewer can run in parallel with no coder active.)

---

## 5. Container Lifecycle

State machine:

```
[New Project]
      │ user first opens
      ▼
[Provisioning] ── cold-start (~60s) ──→ [Running]
                                           │
                                 idle 5 min│ active resume
                                           ▼
                                       [Paused]  (resume <10s, ~10% cost)
                                           │
                                 idle 24 h │ resume
                                           ▼
                                      [Archived]  (restore ~60s, storage-only cost)
                                           │
                                  project deleted
                                           ▼
                                     [Destroyed]
```

### 5.1 Cold-Start Sequence (first spawn of a new project)

1. Daytona allocates container from **pre-built base image** containing Node 24, pnpm, git, Claude Code CLI, Codex CLI
2. `git clone` from host's bare-repo store (tunnelled)
3. `pnpm install` (layer-cached where possible)
4. Write `.claude/` from template registry based on project type
5. Inject API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, others) via Daytona env
6. Start `next dev` on :3000 and `agent-broker` on :4000
7. Report "ready" to host → host flips UI state

**Target**: <60s with cached base image on first spawn, <10s on resume from Paused, <90s from Archived.

### 5.2 Cold-Start UX

Initial implementation: serial start — container boots, then Planner runs inside it. Target cold-start <60s; if user-perceived latency during boot is unacceptable after Phase 1 measurement, parallelising the Planner (e.g., on the host or in a pre-warmed pool) becomes a Phase 4 optimisation. This is flagged in §12. The architectural rule that "all LLM calls run inside containers" (§3.2) holds for MVP; any future parallelism change requires revisiting that rule.

---

## 6. Host ↔ Container Protocol

A single JSON-over-WebSocket message bus, bidirectional, typed.

### 6.1 Host → Broker

```ts
{ type: 'agent.prompt',  agentId: 'orchestrator', prompt: string, sessionId: string }
{ type: 'agent.abort',   agentId: string }
{ type: 'file.write',    path: string, content: string }
{ type: 'file.read',     path: string, requestId: string }
{ type: 'git.revert',    to: string /* commit sha */ }
```

### 6.2 Broker → Host

```ts
{ type: 'agent.chunk',   agentId: string, chunk: string }
{ type: 'agent.status',  agentId: string, phase: 'planning'|'writing'|'reviewing'|'done', meta?: object }
{ type: 'agent.done',    agentId: string, durationMs: number, tokens: {in,out}, costUsd: number }
{ type: 'file.changed',  path: string, source: 'agent'|'external' }
{ type: 'file.content',  path: string, content: string, requestId: string }
{ type: 'build.log',     line: string, stream: 'stdout'|'stderr' }
{ type: 'git.commit',    sha: string, summary: string, filesChanged: number }
{ type: 'error',         code: string, message: string }
```

The host forwards these events to the browser after auth-filtering and simultaneously persists key events (agent.done, git.commit, user messages) to Postgres so they survive browser refresh and container pause.

### 6.3 User ↔ Agent Edit Conflict Handling (MVP: Soft Lock)

- Editor visually marks read-only while any agent task is active for that project
- User saves are queued locally and flushed after `agent.done`
- No merge logic in MVP; v2 may add CRDT / operational transform

---

## 7. Persistence

### 7.1 Data Categorisation

| Data | Store | Reason |
|------|-------|--------|
| User / project metadata | Postgres | Queryable without container |
| Chat history, agent events | Postgres | Survives pause; enables replay |
| Project source code | Bare git repo in blob/volume | Versioning, rollback, export |
| `node_modules`, `.next/` | Container volume only | Regenerable |
| User secrets (env vars) | Host secret store; injected at container boot | Never committed |

### 7.2 Postgres Schema (first cut — Prisma)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  projects  Project[]
}

model Project {
  id          String   @id @default(cuid())
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id])
  name        String
  repoPath    String              // location of bare git repo
  containerId String?             // Daytona container ID
  status      ProjectStatus
  createdAt   DateTime @default(now())
  lastActive  DateTime @default(now())
  sessions    Session[]
  commits     Commit[]
}

enum ProjectStatus { PROVISIONING RUNNING PAUSED ARCHIVED DESTROYED }

model Session {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id])
  title         String
  createdAt     DateTime @default(now())
  lastMessageAt DateTime @default(now())
  messages      Message[]
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  session   Session  @relation(fields: [sessionId], references: [id])
  role      String   // 'user' | 'agent' | 'system'
  agentId   String?  // which sub-agent produced this if role=agent
  content   String
  tokensIn  Int?
  tokensOut Int?
  costUsd   Float?
  createdAt DateTime @default(now())
}

model Commit {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id])
  sessionId String?
  sha       String
  summary   String
  filesChanged Int
  createdAt DateTime @default(now())
}
```

### 7.3 Git Commit Strategy

One commit per agent turn:
- Author: `ai-coder <bot@website-builder-daytona>`
- Message: first line from orchestrator summary; body includes the user prompt and the plan artefact reference
- Committed by the broker inside the container via `simple-git` after Reviewer passes
- Commit row written to `Commit` table with `sessionId` link

User edits made via the editor between agent turns are committed by the broker at the start of the next turn with author `user <user-email>` and an auto-generated message.

Rollback = `git reset --hard <sha>` inside container, new commit row written.

---

## 8. Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Host framework | Next.js 16 (App Router) | Already scaffolded in repo root |
| UI components | shadcn/ui + Tailwind v4 | Tailwind already installed |
| Editor | Monaco | Matches Lovable's choice |
| WebSocket | `ws` (server) + native `WebSocket` (browser) | Next.js 16 Node runtime handles this cleanly |
| Auth | Better Auth | Per user choice |
| DB | Postgres (self-hosted Docker) + Prisma | Per user choice |
| Blob / Git storage | MinIO (S3-compatible) or local volume with bare git repos | Flexible for later cloud migration |
| Container orchestration | Daytona SDK (TypeScript) | Per user requirement |
| Agent CLIs | Claude Code + Codex | Per user requirement |
| Broker (in container) | Node.js + `ws` + `chokidar` + `simple-git` | Minimal custom service |

**Next.js 16 caveat**: AGENTS.md flags that this Next.js version has breaking changes; all host implementation must consult `node_modules/next/dist/docs/` before writing framework-specific code.

---

## 9. Build Phases

Sequenced for working-software-early. Each phase is a separate writing-plans cycle.

**Phase 1 — "Hello Agent" (Weeks 1–2)**
End-to-end proof: one container, Orchestrator + Coder-Claude only, one prompt produces one file, preview updates. No editor edits, no multi-agent. Validates Daytona-plumbing, WS protocol, git commit flow.

**Phase 2 — "Agent Team" (Week 3)**
Add Planner, Explorer, Reviewer, Codex-Rescue. Implement pipeline with artefacts in `.agent-artifacts/`. Chat shows per-agent status events.

**Phase 3 — "Editor Layer" (Week 4)**
FileTree, Monaco editor, soft-lock during agent turns. User edits become commits.

**Phase 4 — "Lifecycle + Persistence" (Week 5)**
Pause/resume automation, archive-restore, commit-per-turn wiring, rollback UI, project dashboard.

**Phase 5 — "Polish" (Week 6)**
Better Auth multi-user, per-user resource isolation, error UX, documentation.

**Realistic MVP timeline: 6 weeks of focused work** (human + agent collaboration).

---

## 10. Explicitly Out of MVP Scope

- GitHub sync ("push to GitHub" button)
- Branches / "what-if" experiments
- Real-time multi-user collaboration (CRDT)
- Warm-pool containers
- Billing / payments
- One-click external deployment (Vercel push)
- MCP bridge for host-exposed tools to container agents
- Mobile UI
- Observability dashboard (agent metrics aggregation)

---

## 11. Top Risks and Mitigations

1. **Cold-start latency >60s even with cached image** → UX suffers.
   - *Mitigation*: Planner runs in parallel during boot; clear staged progress UI; invest in base-image optimisation early in Phase 1.

2. **Agent costs balloon** → a runaway Planner could hit $5+ per turn.
   - *Mitigation*: Hard token/tool-call limits in broker; per-turn cost shown in UI; daily quota per user.

3. **Editor ↔ Agent file-write race** → lost edits.
   - *Mitigation*: Soft-lock during agent turns; queue user saves; document behaviour clearly.

4. **Claude Code + Codex stepping on each other's filesystem writes** → corrupted state.
   - *Mitigation*: Broker serialises code-mutating agents; only one active at a time in MVP.

5. **Daytona SDK / API changes or limitations surface late** → late rework.
   - *Mitigation*: Phase 1 is specifically a plumbing validation; spike Daytona-heavy parts first.

6. **WebSocket scale** — one connection per active session × hundreds of users
   - *Mitigation*: MVP targets low dozens of concurrent sessions; Next.js 16 Node runtime handles this. Scale question deferred.

---

## 12. Open Items (to resolve during writing-plans)

- Whether to parallelise Planner during cold-start as a Phase 4 optimisation (and if so: host-side process, pre-warmed pool, or other) — currently serial in MVP
- Base-image build pipeline (who builds it, where it lives)
- Template registry structure (what starter templates are offered at project creation)
- Secret injection flow (host → Daytona env) — Daytona API specifics to confirm
- FileTree virtualisation library choice
- Git-tunnel mechanism (SSH vs HTTPS vs sidecar) for clone/push between container and host blob store

---

## 13. Next Step

After user approval of this spec: invoke **writing-plans** skill to create the Phase 1 implementation plan. Each subsequent phase gets its own plan in a later session.
