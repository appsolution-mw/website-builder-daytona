# Global OpenHands Library Design Spec

**Date:** 2026-04-29
**Status:** Design, awaiting user review
**Project root:** `/Volumes/Extern/Projekte/website-builder-daytona`
**Chosen approach:** Option A - database-managed global personal library with immutable internal revisions, session snapshots, and deterministic import/export.

---

## 1. Goal

Build a global personal library for OpenHands skills, agents, and workflow/session presets that can be reused across projects.

The library should be managed inside this app, support internal version history with diffs and rollback, and allow each agent session to dynamically activate a selected set of skills, agents, tools, model settings, and runtime settings.

The default behavior must be reproducible: when a session starts, it receives a snapshot of the exact library revisions that were active at that moment. Later edits to the library do not silently change old sessions.

---

## 2. Documentation Findings

OpenHands SDK represents skills as prompt/context objects attached to an `Agent` through `AgentContext`. Skills can be always active, keyword-triggered, or loaded from AgentSkills-compatible `SKILL.md` directories with progressive disclosure.

Installed skills and plugins have persistent `enabled` flags. The SDK exposes lifecycle APIs such as `install_skill()`, `enable_skill()`, `disable_skill()`, and equivalent plugin APIs.

OpenHands agents are created through `Agent(...)`, preset helpers such as `get_default_agent(...)`, `AgentSettings(...).create_agent()`, and delegation support through `DelegateTool`. User-defined agent types can be registered with `register_agent(...)`; file-based agents can be registered where supported by the installed SDK version.

Remote Agent Server uses the same `Conversation` API. Switching local to remote execution is primarily a workspace change, such as `DockerWorkspace`, `APIRemoteWorkspace`, `OpenHandsCloudWorkspace`, or `Workspace(host=...)`. Dynamic skills and agent configuration remain conversation/agent concerns, but executable extensions such as custom tools must exist in the server or sandbox image.

Sources:

- https://docs.openhands.dev/sdk/guides/skill
- https://docs.openhands.dev/sdk/guides/plugins
- https://docs.openhands.dev/sdk/guides/agent-delegation
- https://docs.openhands.dev/sdk/guides/agent-settings
- https://docs.openhands.dev/sdk/guides/agent-server/overview
- https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox
- https://docs.openhands.dev/sdk/guides/agent-server/api-sandbox
- https://docs.openhands.dev/sdk/guides/agent-server/custom-tools

---

## 3. Chosen Approach

Use the app database as the source of truth for the personal library.

The library has three versioned artifact types:

- `Skill`: OpenHands-compatible skill content, frontmatter, triggers, tags, and optional resource metadata.
- `Agent`: role definition, delegation name, tool policy, model preference, and OpenHands registration strategy.
- `WorkflowPreset`: a reusable session recipe containing selected skills, agents, model, tools, runtime, and future remote execution settings.

Every artifact has immutable revisions. Rollback creates a new revision from an older revision instead of mutating history.

Sessions use snapshots by default. New sessions use the latest published preset and item revisions. Existing sessions keep their stored snapshot until the user explicitly updates them after reviewing a diff.

Deterministic import/export makes the DB-managed library versionable outside the app, but automatic Git commits and bidirectional Git sync are not part of the MVP.

---

## 4. Architecture

The current app already has a runtime boundary around the sandbox broker and OpenHands bridge:

- Browser sends `agent.prompt` with runtime and model state.
- The host and `ws-proxy` forward agent turns to the sandbox broker.
- The broker starts `openhands_bridge.py` for OpenHands turns.
- The bridge creates an OpenHands `Agent`, `AgentContext`, and `Conversation`.
- Bridge JSONL is mapped back to existing `agent.*` events.

The new library layer sits above this runtime boundary:

```text
Library UI / API
  -> LibraryItem + LibraryRevision
  -> WorkflowPreset resolution
  -> SessionLibrarySnapshot
  -> OpenHands runner env / snapshot path
  -> Python bridge renders OpenHands-compatible files
  -> Conversation(agent=agent, workspace=...)
```

At turn time the OpenHands runner should not rely on mutable library names. It receives a snapshot reference or snapshot payload that has already resolved the exact revisions and content for that session.

The bridge renders snapshot skills into a temporary session-scoped location, for example:

```text
.openhands/session/<sessionId>/snapshot.json
.openhands/session/<sessionId>/skills/<slug>/SKILL.md
.openhands/session/<sessionId>/agents/<slug>.md
```

Then the bridge loads only those session files. This keeps OpenHands behavior stable even if the global library changes.

Project-local `.openhands/skills` can remain a future or optional supplement, but the global DB library is the primary source of truth for this feature.

---

## 5. Data Model

Use a small generic model with strongly understood artifact types.

```text
LibraryItem
- id
- userId
- type: SKILL | AGENT | WORKFLOW_PRESET
- slug
- name
- description
- tags
- status: DRAFT | PUBLISHED | ARCHIVED
- currentRevisionId
- createdAt
- updatedAt
```

```text
LibraryRevision
- id
- itemId
- version
- title
- content
- configJson
- checksum
- createdAt
- createdBy
- changeNote
```

`content` stores the primary Markdown body for skills and agents. `configJson` stores structured settings such as triggers, allowed tools, model preference, remote mode, and preset membership.

Workflow preset revision example:

```json
{
  "runtime": "openhands",
  "modelId": "openrouter:anthropic/claude-sonnet-4.5",
  "skills": [
    { "itemId": "skill-nextjs", "revisionId": "rev-3" }
  ],
  "agents": [
    { "itemId": "agent-reviewer", "revisionId": "rev-5" }
  ],
  "tools": ["TerminalTool", "FileEditorTool", "TaskTrackerTool", "DelegateTool"],
  "remote": {
    "mode": "local"
  }
}
```

Session snapshot:

```text
SessionLibrarySnapshot
- id
- projectId
- sessionId
- sessionRuntimeStateId
- presetItemId
- presetRevisionId
- snapshotJson
- createdAt
```

`SessionLibrarySnapshot` is anchored to `SessionRuntimeState` because the active library set is runtime-specific. `projectId` and `sessionId` are denormalized for simple lookups and ownership checks.

`snapshotJson` stores the fully resolved content and configs, not only revision IDs. IDs remain for traceability, but content is duplicated for reproducibility.

---

## 6. Revision, Diff, and Rollback Behavior

Revision rules:

- Revisions are immutable.
- Publishing an edit creates a new `LibraryRevision`.
- `LibraryItem.currentRevisionId` points to the currently published revision.
- Archived items cannot be selected in new presets, but old snapshots remain valid.
- Rollback creates a new revision whose content/config is copied from the selected older revision.

Diff behavior:

- Skill and agent diffs compare Markdown content and structured config.
- Preset diffs compare selected skills, selected agents, model, runtime, tools, and remote settings.
- Session update previews show what would change before mutating a session snapshot.

Session update behavior:

- Existing sessions keep their snapshot.
- If newer published revisions exist, the UI can show an update available state.
- Updating a session creates a new snapshot after user confirmation.

---

## 7. UI and Workflows

Add three app areas.

### Library

Shows skills, agents, and workflow presets with search, type filter, status filter, tags, and current revision.

### Editor

Artifact-specific editing:

- Skill editor: Markdown/`SKILL.md` content, description, triggers, tags, status.
- Agent editor: role content, delegation name, allowed tools, model preference, tags.
- Preset editor: selected skills, selected agents, model, tools, runtime, remote mode.

Edits are drafts until published as a revision.

### Session Setup

Before starting or reconfiguring a session:

- Select a workflow preset.
- Inspect resolved skills and agents.
- Optionally enable or disable items for this session.
- Start session, which creates `SessionLibrarySnapshot`.
- For existing sessions, show available updates with diff preview.

Activation has two layers:

- Library status controls whether an item can be used in new configurations.
- Session activation controls which item revisions are included in a specific snapshot.

---

## 8. OpenHands Integration

Keep the existing TypeScript runner plus Python bridge architecture.

Host/session flow:

1. User selects a preset and optional overrides.
2. Host resolves the preset into exact library revisions.
3. Host stores `SessionLibrarySnapshot`.
4. Broker receives the snapshot reference or payload for each OpenHands turn.
5. `openhands-runner.ts` passes a snapshot path through environment or process args.
6. `openhands_bridge.py` renders the snapshot into OpenHands-compatible files.
7. Bridge loads exactly those skills and agents into `AgentContext` and agent registration.

Example runner env:

```env
OPENHANDS_LIBRARY_SNAPSHOT_PATH=/workspace/project/.openhands/session/<sessionId>/snapshot.json
```

Skill rendering:

- DB skill content becomes `SKILL.md`.
- Trigger data is rendered into supported frontmatter.
- Only session-active snapshot skills are rendered and loaded.

Agent rendering:

- Prefer OpenHands file-based agents where supported by the SDK version in the sandbox.
- Fallback to always-loaded agent-definition skills or bridge-side `register_agent(...)` factories.
- Keep the representation compatible with SDK drift by isolating this logic in the Python bridge.

Tool policy:

- Presets may allow built-in tools such as `TerminalTool`, `FileEditorTool`, `TaskTrackerTool`, and `DelegateTool`.
- Custom tools are only selectable if they are allowlisted and already present in the sandbox or remote server image.

Remote Agent Server:

- Not part of the first runtime default.
- Preserve `remote.mode` in preset config for later `local | docker | api | cloud` support.
- Snapshot resolution remains the same when remote execution is added; only the workspace backend changes.

---

## 9. Import and Export

Export should produce deterministic files that are friendly to Git:

```text
library.json
skills/<slug>/SKILL.md
skills/<slug>/metadata.json
agents/<slug>.md
agents/<slug>.json
presets/<slug>.json
```

Export rules:

- Stable sort by type and slug.
- Stable JSON formatting.
- Include checksums and revision metadata.
- Do not export secrets or runtime-sensitive values.

Import rules:

- Match existing items by type and slug.
- Create new items when slugs do not exist.
- Create new revisions when imported content/config differs.
- Do not overwrite immutable revision records.
- Report conflicts when the same slug has incompatible metadata.

Automatic Git commits, remote repository auth, and bidirectional sync are deferred.

---

## 10. Security

Security defaults:

- Dynamic skill command execution using `!`command`` is disabled for DB-managed skills unless a future explicit trust flag enables it.
- Session snapshots must not include secrets.
- Export must strip secrets and local-only credentials.
- Custom tools are allowlisted; arbitrary custom tool code cannot be uploaded from the UI in the MVP.
- Remote execution must require explicit workspace mode and credentials when implemented later.
- Archived library items cannot be newly selected, but old snapshots can still render them.

The OpenHands docs warn that dynamic command execution runs with full shell privileges. Treat DB-managed global skills as trusted content only after explicit user action.

---

## 11. MVP Scope

Included:

- Prisma models for library items, revisions, and session snapshots.
- CRUD for skills, agents, and workflow presets.
- Publish revision.
- Diff revisions.
- Rollback as new revision.
- Resolve preset into session snapshot.
- OpenHands bridge loads snapshot skills and agents.
- Deterministic import/export.

Excluded:

- Automatic Git commits.
- Bidirectional Git sync.
- Marketplace/plugin installation.
- Remote Agent Server as production default.
- Arbitrary custom tool upload.
- Multi-user collaboration beyond existing app user ownership patterns.

---

## 12. Testing Strategy

Library service tests:

- Revision records are immutable.
- Publishing creates a new revision.
- Rollback creates a new revision copied from an older revision.
- Archived items cannot be selected for new presets.
- Preset resolution produces fully materialized snapshots.

Diff tests:

- Markdown content diffs are stable.
- JSON config diffs detect model, tool, skill, and agent changes.

Import/export tests:

- Export output is deterministic.
- Import creates new revisions only when checksums differ.
- Secrets are not exported.

OpenHands bridge tests:

- Snapshot path is accepted and loaded.
- Only active snapshot skills are rendered.
- Agent fallback path works when file-based agent APIs are unavailable.
- Tool allowlist affects the created `Agent` tool list.

Session flow tests:

- New sessions use current published revisions.
- Existing sessions keep old snapshots after library edits.
- Explicit update creates a new snapshot.

Verification commands for implementation phase:

```bash
pnpm -F @wbd/broker test
pnpm test:host
pnpm build
```

---

## 13. Implementation Planning Decisions

- `SessionLibrarySnapshot` belongs to `SessionRuntimeState`, with `projectId` and `sessionId` also stored for access checks and queries.
- The first UI should expose the full library list, focused editors, and preset/session selection. Import/export can be utility-style before it gets a polished interface.
- Diff output should start with a unified text diff for Markdown content plus a structured JSON summary for config changes.
- The bridge should keep SDK compatibility guards. It should prefer file-based agent APIs when present and fall back to agent-definition skills when the installed OpenHands SDK does not expose the expected agent registration surface.
