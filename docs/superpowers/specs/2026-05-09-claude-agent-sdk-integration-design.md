# Claude Agent SDK Integration — Design

Task: [T-20260509-001](../../tasks/active/T-20260509-001.md)
Date: 2026-05-09
Status: Draft (awaiting user review)

## 1. Goal

Replace the current Claude Code integration (CLI subprocess invoked from the
sandbox broker via `claude --print --output-format stream-json`) with the
official `@anthropic-ai/claude-agent-sdk`. The new integration must deliver:

- **Token-level streaming** to the browser for an interactive build experience.
- **Robust session resume**: SDK JSONL primary, host DB-replay fallback.
- **Multimodal attachments** (images, PDFs, files) end-to-end.
- **Native Skills, Subagents, CLAUDE.md** — sourced from a host-curated
  defaults set, mergeable with per-project overrides under `.claude/`.
- **Permission gating** via PreToolUse hooks (destructive-pattern blocklist,
  workspace-boundary enforcement).
- **Hard cutover** in a single PR. CLI binary removed from the sandbox image.

Out of scope for V1: subagent-hierarchy UI, in-chat tool-approval prompts,
per-sandbox persistent volumes, migration of other runtimes (codex, vercel-ai,
openhands), `provider_event_log` table.

## 2. Decisions (recap)

| # | Decision | Rationale |
|---|---|---|
| 1 | SDK runs in a **dedicated Node service inside the sandbox** (sibling to the broker), at `container/sandbox/agent-runner/`. | Keeps sandbox isolation, gives long-running iterators with clean cancel and clean process boundary. The repo-root `worker-agent/` is the host-side fleet manager and is unrelated. |
| 2 | **Hybrid resume**: SDK JSONL primary; if missing, transparent fallback to a DB-replay primer. | Survives sandbox restart and worker-node migration without coupling to volume lifecycle. |
| 3 | **V1 streaming protocol**: map SDK events to existing `agent.*` broker events; add `costUsd`/`subtype`/`usage` to `agent.done`; add two new events (`agent.policy_violation`, `agent.resume_status`). | Smallest protocol diff, browser chat UI works unchanged. |
| 4 | **CLAUDE.md / Skills / Subagents**: host-curated defaults (in repo-root `agent-context/`) + per-project overrides; merged into `/workspace/.claude/` at sandbox bootstrap. | Consistent agent behaviour across all user projects, but extensible per-project. |
| 5 | **Permissions**: `permissionMode: "acceptEdits"` + PreToolUse hooks for destructive patterns and workspace-boundary enforcement. No in-chat approval prompts in V1. | Smooth v0/Lovable build experience; safety via deterministic policy and audit log. |
| 6 | **Migration**: hard cutover. Single PR, CLI deleted, SDK in. | User preference; smaller code surface; clearer review. |

## 3. Architecture

```
Browser (Chat UI)
   │  WebSocket  (existing)
   ▼
Host  (Next.js 16)  ──Prisma──▶  Postgres
   │  Broker WS   (existing protocol + small additions)
   ▼
Sandbox container (per project, on a worker node)
   ├── broker  (container/sandbox/broker/)
   │     ├── deletes claude-runner.ts
   │     └── adds claude-sdk-bridge.ts  (forwards to agent-runner over loopback HTTP)
   ├── agent-runner  (NEW — container/sandbox/agent-runner/)
   │     ├── Fastify server, listens on 127.0.0.1
   │     ├── HMAC-validated endpoints (shared secret with broker)
   │     ├── @anthropic-ai/claude-agent-sdk
   │     └── In-memory Map<providerSessionId, AsyncIterator> for cancel
   └── /workspace/                 ← project files (existing)
        └── .claude/               ← merged host-defaults + project overrides
              ├── CLAUDE.md
              ├── skills/<name>/SKILL.md
              └── agents/<name>.md
```

**Replacement boundary**:
- `container/sandbox/broker/src/claude-runner.ts` → deleted.
- New: `container/sandbox/broker/src/claude-sdk-bridge.ts` (thin proxy).
- New: `container/sandbox/agent-runner/` (Fastify service holding the SDK).

The host (`lib/agents/runtimes/claude-code/`) and the broker protocol
(`packages/protocol/`) are modified; everything else (worker-pool, sandbox
provisioning, host UI streaming) is untouched.

## 4. Components

### 4.1 agent-runner (new service in sandbox)

Path: `container/sandbox/agent-runner/`. Sibling to broker, same container,
bound to `127.0.0.1` only. Single process, started by the same supervisor that
launches the broker.

**Endpoints** (all HMAC-signed, body+timestamp signature; shared secret read
from container env at start):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/claude-sdk/turn` | Start a turn; SSE response of SDK events. |
| `POST` | `/claude-sdk/cancel/:providerSessionId` | Calls `iterator.cancel()`. |
| `POST` | `/claude-sdk/bootstrap` | One-time-per-sandbox: merge host-defaults + project overrides into `/workspace/.claude/`. |
| `GET`  | `/healthz` | Liveness. |

**`/claude-sdk/turn` request body**:

```ts
{
  sessionId: string;            // host-side session id (for logging)
  providerSessionId: string;    // SDK session id, persisted in SessionRuntimeState
  resumeRequested: boolean;     // host's intent
  prompt: string;               // user prompt (already redacted/normalized)
  attachments: Array<{          // already validated against limits in the host
    name: string;
    mimeType: string;
    dataBase64: string;
  }>;
  replayContext?: Array<{       // last N messages (attachments redacted), for fallback
    role: "user" | "assistant";
    text: string;
  }>;
  allowedTools?: string[];
  agents?: Record<string, AgentDef>;
  skills?: "all" | string[];
  mcpServers?: Record<string, McpConfig>;
  modelId?: string;
  systemPromptAppend?: string;
  turnId: string;
}
```

**Response**: SSE (`Content-Type: text/event-stream`). Each line is a JSON
broker event ready for the broker to forward upstream — see §5 for mapping.

**In-memory state**:
- `Map<providerSessionId, { iterator, abortController, startedAt }>` for cancel.
- LRU max 32 in-flight turns per sandbox.

**SDK invocation** (canonical):

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const iterator = query({
  prompt: req.body.prompt,
  options: {
    cwd: "/workspace",
    resume: req.body.resumeRequested ? req.body.providerSessionId : undefined,
    settingSources: ["project"],          // loads /workspace/.claude/
    skills: req.body.skills ?? "all",
    agents: req.body.agents,
    mcpServers: req.body.mcpServers,
    allowedTools: req.body.allowedTools,
    permissionMode: "acceptEdits",
    includePartialMessages: true,         // token-level deltas
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: req.body.systemPromptAppend,
    },
    hooks: buildPolicyHooks(),            // §4.5
    excludeDynamicSections: true,         // prompt-cache friendly
    model: req.body.modelId ?? defaultModel(),
  },
  // attachments injected via input messages — see §6
});
```

### 4.2 Broker bridge (modified)

Path: `container/sandbox/broker/src/claude-sdk-bridge.ts`.

Replaces `claude-runner.ts`. Receives `BrokerToWorker.start_turn` over WS,
makes a single HMAC HTTP POST to `http://127.0.0.1:<port>/claude-sdk/turn`,
consumes the SSE stream, and forwards each event verbatim through the existing
WS bridge to the host.

**Mapping table** (agent-runner emits already-mapped broker events; the bridge
is just a pass-through with one transform: it enriches each event with
`turnId`, which the broker tracks in its task-map):

| Source SDK message | Broker event | Notes |
|---|---|---|
| `system` (subtype `init`) | (consumed internally) | agent-runner extracts `session_id`, emits `agent.resume_status` (§4.6). |
| `stream_event` (text_delta) | `agent.chunk { text }` | Existing event, unchanged shape. |
| `assistant` (tool_use block) | `agent.tool_use { name, input }` | Existing event, unchanged shape. |
| `user` (tool_result block) | `agent.tool_result { ok, content }` | Existing event, unchanged shape. |
| `result` | `agent.done { sessionId, costUsd, subtype, usage }` | **New fields** on existing event. |
| (synthesized by hook) | `agent.policy_violation { tool, reason, redactedInput }` | **New event**. |
| (synthesized at session_id detection) | `agent.resume_status { resumed: boolean }` | **New event**, emitted exactly once per turn. |

`stream_event.input_json_delta`, `assistant` extended-thinking blocks, and
non-text content are not forwarded in V1 (logged for debugging only).

### 4.3 Host adapter (modified)

Path: `lib/agents/runtimes/claude-code/`.

Removed: NDJSON parsing, `--print` arg construction, CLI-specific resume-state
serialization.

Added:

- **Replay-context builder** (`replay-context.ts`): given a `Session`, returns
  the last 20 messages flattened to `{ role, text }`. Attachments are redacted
  to `[attachment: <name> (<size>)]` placeholders to keep tokens bounded. Used
  for the fallback path described in §7.
- **Turn dispatcher** (`turn-dispatcher.ts`): builds the `start_turn` payload,
  ensures `replayContext` is always included, sends it through the broker.
- **Event sink** (`event-sink.ts`): consumes the `agent.*` events from the
  broker WS:
  - `agent.chunk` → append to in-progress assistant `Message.content`.
  - `agent.tool_use` / `agent.tool_result` → persist as structured turn events
    on the `Message` (existing schema; no new tables).
  - `agent.policy_violation` → append to message metadata + structured logger.
  - `agent.resume_status` → if `resumed: false`, log a warning event; do not
    surface to UI (transparent fallback).
  - `agent.done` → finalize `Message`, write `costUsd`, `usageJson`, `subtype`;
    update `SessionRuntimeState.providerSessionId` and `lastUsedAt`.

The host adapter still implements the existing `RuntimeAdapter` interface
(no signature changes); other runtimes (codex, vercel-ai, openhands) are
unaffected.

### 4.4 Agent context (new)

Path at repo root: `agent-context/`.

```
agent-context/
  CLAUDE.md                            ← website-builder-agent project conventions
  skills/
    frontend-design/SKILL.md
    nextjs-app-router/SKILL.md
    tailwind-conventions/SKILL.md
    accessibility-quick-pass/SKILL.md
  agents/
    code-reviewer.md                   ← replaces today's REVIEWER_PROMPT
    ui-designer.md
```

V1 ships a small curated set (3–5 skills, 2–3 subagents). Authoring is
file-format identical to local Claude Code skills/agents (frontmatter +
markdown body).

**Sandbox image bake-in**: the sandbox `Dockerfile` copies `agent-context/`
into `/opt/agent-context/`. No network call at runtime, no per-deploy
publish step.

**Bootstrap merge** (executed by agent-runner's `/claude-sdk/bootstrap`
endpoint, called once per sandbox lifetime, before the first turn):

1. Ensure `/workspace/.claude/` exists.
2. For each path in `/opt/agent-context/`:
   - If a same-named path exists in `/workspace/.claude/`, the project copy
     wins (per-file replace).
   - Otherwise copy the host default into `/workspace/.claude/`.
3. Special-case `CLAUDE.md`: if both exist, write
   `<host-CLAUDE.md>\n\n## Project Notes\n<project-CLAUDE.md>` to
   `/workspace/.claude/CLAUDE.md`.

The merge is idempotent and runs at most once per sandbox boot.

### 4.5 Permission hooks (new)

Path: `container/sandbox/agent-runner/src/policy-hooks.ts`.

```ts
export function buildPolicyHooks() {
  return {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [denyDestructiveBash, denyOutboundNetworkExfil],
      },
      {
        matcher: "Write|Edit",
        hooks: [denyOutsideWorkspace],
      },
    ],
  };
}
```

**`denyDestructiveBash`** — regex blocklist applied to `tool_input.command`.
Initial set:
- `\brm\s+-rf?\s+/(?!workspace\b)` (rm -rf outside /workspace)
- `:\s*\(\s*\)\s*\{\s*:\|:\s*&\s*\}\s*;` (fork bomb)
- `\bdd\s+if=/dev/(zero|random)`
- `\bmkfs(\.|\s)` / `\bdd\s+of=/dev/`
- `>\s*/(etc|boot|root|var/log|sys|proc)\b`

**`denyOutboundNetworkExfil`** — denies `curl|wget|nc` to hosts not on an
allowlist (V1 allowlist: `npmjs.org`, `registry.npmjs.org`, `github.com`,
`raw.githubusercontent.com`, `cdn.jsdelivr.net`, `unpkg.com`,
`fonts.googleapis.com`, `fonts.gstatic.com`).

**`denyOutsideWorkspace`** — denies `Write`/`Edit` to absolute paths not
prefixed with `/workspace/`.

On block: hook returns `{ allow: false, reason: "<short reason>" }`. The
agent-runner additionally emits an `agent.policy_violation` event over SSE so
the broker can forward it. `tool_input` is redacted (long strings truncated
to 200 chars; secrets-like keys removed) before emission.

### 4.6 Resume-status detection

The agent-runner emits `agent.resume_status` exactly once per turn, before any
text-delta:

- If `resumeRequested && firstSystemInit.session_id === providerSessionId` →
  `{ resumed: true }`.
- If `resumeRequested && firstSystemInit.session_id !== providerSessionId` →
  the SDK silently started a fresh session (JSONL missing). The agent-runner
  cancels the iterator, then re-runs `query()` with **no `resume`** and a
  reconstructed `prompt` that prepends the `replayContext` as a synthetic
  prior conversation primer. Emits `{ resumed: false }`.
- If `!resumeRequested` → no event emitted (fresh session was intended).

The host treats `resumed: false` as a transparent operational signal — logged
but not surfaced in chat. The user sees a continuous experience.

## 5. Turn flow

```
Browser  ─POST /api/.../messages──▶  Host
Host     ─persist Message + MessageAttachment rows
Host     ─Broker WS: start_turn{
              providerSessionId, resumeRequested, prompt,
              attachments, replayContext (last 20, redacted),
              allowedTools, agents, skills, mcpServers, modelId
           }
Broker   ─HMAC POST 127.0.0.1 /claude-sdk/turn
Agent-runner ─query(...)  iterator
              │  emit agent.resume_status (resumed?)
              │  emit agent.chunk*       (text deltas)
              │  emit agent.tool_use / tool_result
              │  emit agent.policy_violation (if blocked)
              └  emit agent.done { sessionId, costUsd, subtype, usage }
Browser  ◀── all agent.* events via existing WS bridge
Host     ─on agent.done: persist final Message, costUsd, usageJson, subtype;
           update SessionRuntimeState (providerSessionId, lastUsedAt)
```

## 6. Attachments

DB format unchanged: `MessageAttachment.dataBase64`. Agent-runner constructs
SDK content blocks from the `attachments` array:

- `image/*` → `{ type: "image", source: { type: "base64", media_type, data } }`
- `application/pdf` → `{ type: "document", source: { type: "base64", media_type, data } }` if SDK accepts; else write to `/workspace/attachments/<id>.pdf` and reference path in the text prompt.
- Other text-shaped (`text/*`, `application/json`) ≤ 32 KB → inline as text block prefixed by `[attachment <name>]`.
- All others → write to `/workspace/attachments/<id>` and reference path.

**Limits** (host-side enforced before broker call):
- 10 MB per attachment, 25 MB total per turn, max 10 attachments per turn.

## 7. Sessions and resume

- `SessionRuntimeState.providerSessionId` is the SDK session id (string,
  whatever the SDK emits in its first `system.init`).
- On every turn, host sends `resumeRequested: true` if a `providerSessionId`
  exists for that session+runtime row, else `false`.
- Agent-runner runs the resume-detection in §4.6.
- DB-replay primer (used on JSONL miss): the agent-runner builds a synthetic
  prompt:
  ```
  <replay header>
  user: ...
  assistant: ...
  user: ...
  ...
  <new turn separator>
  <actual prompt>
  ```
- On success of a fallback turn, the agent-runner captures the **new**
  `session_id` from the SDK and includes it in the `agent.done` event so the
  host can update `SessionRuntimeState.providerSessionId`.

## 8. Schema migration

Single Prisma migration adding three columns to `Message`:

```prisma
model Message {
  // existing
  costUsd   Decimal? @db.Decimal(10, 6)
  usageJson Json?
  subtype   String?  // success | error_max_turns | error_max_budget_usd | error_during_execution | error_max_structured_output_retries
}
```

No data backfill. No new tables in V1.

## 9. Tests

- `container/sandbox/agent-runner/tests/sdk-mapping.spec.ts` — SDK iterator → SSE event mapping with a mocked SDK.
- `container/sandbox/agent-runner/tests/policy-hooks.spec.ts` — destructive-pattern blocklist, workspace-boundary, network-allowlist; redaction.
- `container/sandbox/agent-runner/tests/bootstrap-merge.spec.ts` — host-defaults + project overrides merge correctness, idempotency, CLAUDE.md concat.
- `lib/agents/runtimes/claude-code/__tests__/replay-context.spec.ts` — last-20 builder, attachment redaction.
- `lib/agents/runtimes/claude-code/__tests__/event-sink.spec.ts` — `agent.done` persists costUsd/usageJson/subtype; resume-status warning path.
- `e2e/claude-agent-sdk.spec.ts` (Playwright):
  1. Send message with image attachment, observe streaming text.
  2. Send follow-up, verify resume succeeded.
  3. Restart sandbox container, send another follow-up, verify DB-replay fallback works (transparent to UI).
  4. Trigger destructive Bash command, verify `agent.policy_violation` and continued conversation.

DB tests use `TEST_DATABASE_URL`. E2E uses staging Hetzner box.

## 10. Implementation slices (subagent-driven)

| Slice | Scope | Effort | Subagent kind | Depends on |
|---|---|---|---|---|
| **A** | `container/sandbox/agent-runner/` — Fastify service, SDK bindings, in-memory session map, bootstrap endpoint, SSE stream | high | feature-dev:code-architect → feature-dev | — |
| **B** | Broker bridge — `claude-sdk-bridge.ts`, delete `claude-runner.ts`, update `agent-provider*` wiring | medium | feature-dev | A (interface), can be parallel-developed against contract |
| **C** | Host adapter — replay-context builder, turn dispatcher, event sink with new fields | high | feature-dev | B (events), can be parallel-developed against contract |
| **D** | `agent-context/` — V1 CLAUDE.md, 3–5 skills, 2–3 subagents | medium | general-purpose | — |
| **E** | Hooks/policy + redaction + tests | medium | feature-dev | A |
| **F** | Prisma migration, sandbox `Dockerfile` cleanup, packages/protocol updates, e2e tests, staging smoke | medium | feature-dev + code-reviewer | A, B, C, D, E |

Slices A/B/C/D run in parallel using contracts as interfaces (event schema,
Fastify route shapes). E builds on A. F integrates everything and runs the
final cutover.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| SDK API drift between docs and shipped version | Pin `@anthropic-ai/claude-agent-sdk` to a specific minor; smoke-test on staging before merge. |
| OpenRouter compatibility (current code routes via OpenRouter when `OPENROUTER_API_KEY` is set) | agent-runner reproduces the env logic from `claude-runner.ts:45-62` (set `ANTHROPIC_BASE_URL` to OpenRouter, scrub `CLAUDE_CODE_OAUTH_TOKEN`). Test path explicitly. |
| JSONL resume regression after sandbox image rebuild (path differences) | Resume detection (§4.6) silently falls back; no user-visible failure. |
| Hook regex false positives blocking legitimate dev commands | Blocklist is small and targeted; allowlist for outbound is explicit; both reviewable. Add escape-hatch env `AGENT_RUNNER_BYPASS_POLICY=1` for staging debug only (never in prod). |
| Hard cutover breaks production | Pre-merge staging smoke covers the four scenarios in §9 e2e. PR description includes manual-test checklist. Rollback path is `git revert` of one PR. |
| Larger sandbox memory usage (long-running iterators) | LRU cap of 32 in-flight turns per sandbox; idle iterators garbage-collected after 60min (matches old CLI timeout). |

## 12. Open questions for review

None — all major decisions captured above. Per-detail refinements (exact
regex set, exact V1 skill list, exact agent-runner port) will be settled
during the implementation plan.
