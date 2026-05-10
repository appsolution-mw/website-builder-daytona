# Workflow Discovery

Date: 2026-05-10
Scope: customer and operator workflows exposed by Website Builder Daytona.

This document maps how the product changes the way website work gets done. It
focuses on the user journeys and operational leverage rather than the route
shape or implementation contract.

## Product Thesis

Website Builder Daytona turns website development into a managed, chat-driven
workspace. A user does not start by cloning a repository, installing
dependencies, configuring an AI coding agent, opening an editor, wiring a
preview, and later figuring out how to turn the work into a commit or pull
request. The product packages those steps into a project workspace:

- A project becomes an isolated running sandbox with a live Next.js preview.
- The chat is not a detached assistant; it is connected to the same filesystem,
  runtime, terminal, preview, run queue, and commit history.
- Files can be edited by both human and agent, with locking while the agent is
  active.
- Runtime state, model selection, prompt history, attachments, usage, and
  commits are durable enough to survive browser reconnects.
- Operators can manage the worker fleet that makes the illusion feel instant.

The important workflow change is that the product collapses the loop between
intent, execution, inspection, correction, and delivery. The user asks for work,
watches the workspace change, inspects the live product, edits files directly
when needed, and can push GitHub-backed work toward a pull request from the same
surface.

## Primary Actors

- Builder: the customer creating or modifying a website.
- Reviewer/operator: a power user inspecting files, history, terminal output, or
  preview console to steer quality.
- Agent/runtime: Claude Code, Codex, and legacy OpenHands-compatible flows that
  perform code changes inside the sandbox.
- Admin/operator: the person responsible for worker capacity, sandbox cleanup,
  and fleet health.

## Workflow 1: Project Creation And Import

### Customer Intent

The user wants a place to work. That place can start from a blank managed
template or from an existing GitHub repository. In both cases the desired
outcome is not just a database record; it is a booted development environment
with a live app preview and an agent-ready workspace.

### Entry Points

The dashboard exposes:

- A project name field.
- A source selector: Template or GitHub.
- GitHub installation, repository, and branch selectors when importing.
- A recent projects list with provisioning and broker readiness status.
- Links to Agent config, Library, and Usage.
- Orphan sandbox cleanup for local/operator maintenance.

### End-To-End Flow

1. The user names a project.
2. If the source is GitHub, the user selects an installed GitHub App account,
   repository, and base branch.
3. The host creates the project, workspace membership context, first chat
   session, runtime preference, source metadata, and optional environment
   content.
4. The runtime reserves capacity on a worker, generates sandbox credentials,
   injects environment and managed OpenHands configuration, then asks the
   worker-agent to create the container.
5. Inside the container, the entrypoint either seeds the managed Next.js
   template or clones the selected GitHub repo. It installs dependencies,
   starts the app dev server, starts the agent-runner, and starts the broker.
6. The worker-agent polls the broker health endpoint. When the broker is ready,
   it notifies the host so the project can move from "running but preparing" to
   workspace-ready.
7. The dashboard polls while provisioning so the user sees when "Open" becomes
   available.

### Value

This turns environment setup into a product action. The user gets an isolated
project, source provenance, live preview, Git state, and agent bridge without
doing local setup. GitHub import is especially important because it lets the
product work on real repositories, not just generated demos.

### Operational Leverage

- Capacity reservation is centralized. Users do not pick machines or ports.
- Broker readiness is explicit, so the UI can avoid opening a broken workspace.
- Template and GitHub projects share the same workspace once running.
- Provisioning failures are sanitized and stored on the project, giving the UI a
  recoverable state instead of an indefinite spinner.

## Workflow 2: Opening The Workspace

### Customer Intent

The user expects the project workspace to be ready for real work, not merely
created. Opening a project checks whether the project is running, whether the
broker is ready, and whether the browser can connect through the WebSocket
proxy.

### End-To-End Flow

1. The workspace loads project metadata, sessions, messages, runtime state, and
   recent commits.
2. If the project is still provisioning, the user stays on a preparation screen.
3. If the host reports the broker is not ready, the workspace polls the project
   until readiness flips.
4. Once ready, the browser connects through the WebSocket proxy to the
   sandbox broker.
5. On socket open, the workspace loads the file tree, hides the Next.js debug
   indicator when possible, checks GitHub pull request status, and injects the
   preview console bridge.

### Value

The product treats readiness as a workflow state, not a hopeful assumption. The
workspace only becomes interactive after the host and browser both agree the
sandbox can respond.

## Workflow 3: Chat-To-Agent Work

### Customer Intent

The user asks for a website change in natural language and expects the agent to
modify the running project. They may also attach context images or a captured
preview region.

### User Experience

The chat panel supports:

- Multiple chat sessions per project.
- Runtime selection per session.
- Model selection where supported.
- Image paste, drag/drop, and preview-region capture.
- Queueing additional prompts while a run is active.
- Abort for the active run.
- Visible stream messages, agent/tool activity, errors, and token/cost footer.
- Queue blocked handling with Retry or Skip.

### End-To-End Flow

1. The user sends a prompt, optionally with images.
2. The host stores the user message and attachments, creates an AgentRun, and
   appends a queued status event.
3. A project-scoped queue drain starts. Only one run can be active for a project
   at a time.
4. The host dispatches the run to the worker-agent, which forwards execution to
   the sandbox broker over the broker internal HTTP surface.
5. The broker invokes the selected runtime inside the sandbox, using the
   project root, runtime state, model selection, attachments, replay context, and
   any library preset snapshot.
6. Runtime events stream back as NDJSON: status, chunks, tool use, usage, file
   changes, errors, completion, and commits.
7. The host persists events into the project event log, persists messages and
   usage, and stores commits when the broker reports one.
8. The browser polls durable events and applies them to the chat, file tree,
   changed-file indicators, and history tab.

### Value

The chat is a production workflow, not a novelty panel. The durable run queue
means a browser reconnect can replay current activity. The queue state protects
the project from overlapping write operations. The blocked state makes failures
actionable instead of letting later prompts pile up behind a hidden error.

### Where Work Changes

Traditional AI coding flow often loses context across tabs, terminal output,
editor state, and git state. Here, the agent turn becomes a first-class project
event. It leaves behind:

- The user prompt and attachments.
- Runtime and model metadata.
- Streaming output and activity.
- File change events.
- Token/cost data.
- A commit, when code changed.

That changes the workflow from "ask an assistant and manually reconcile its
output" to "request a change against a live workspace and inspect the resulting
artifact."

## Workflow 4: Preview And Runtime Inspection

### Customer Intent

The user wants to see the actual website as it changes and use visual feedback
as part of the next prompt.

### User Experience

The preview tab gives:

- A live iframe backed by the sandbox dev server.
- Desktop, tablet, and mobile frames.
- Open-in-new-tab access to the preview URL.
- A capture tool that turns a selected preview region into a chat attachment.
- A "Debug off" control that edits project files and runtime setting to hide
  intrusive Next.js debug UI.
- Project environment and agent config shortcuts from the preview toolbar.

The console tab captures browser console messages from the preview bridge and
groups them by timestamp, level, message, and page path.

### Value

Preview is not passive. It becomes a source of feedback for the agent loop.
Capturing a region lets the user point at visual issues without explaining the
entire layout in prose. Console capture gives non-developers a usable signal
when the page is broken.

### Operational Leverage

The preview URL is provisioned with the sandbox. For routed environments, the
runtime can produce a stable public preview route; for local/worker scenarios it
can fall back to the worker host and port. The product keeps the UI aware of
broker readiness so preview and file operations do not race the container boot.

## Workflow 5: File And Code Interaction

### Customer Intent

The user wants direct control when the agent is too slow, too broad, or needs a
small correction. The workspace therefore includes a real file browser and code
editor instead of forcing every change through chat.

### User Experience

The code tab provides:

- A file tree built from the sandbox filesystem tracker.
- Recently changed markers when the agent or user touches a file.
- Monaco-based editing for common web file types.
- Save with keyboard shortcut support.
- Read-only lock while an agent turn is active.
- A project `.env` side panel.
- A project agent-config side panel.

### End-To-End Flow

1. The browser asks the broker for the file list over WebSocket.
2. Selecting a file reads it from the sandbox project root.
3. Saving writes through the broker with path and size checks.
4. The broker refuses writes while an agent run is active.
5. The filesystem tracker broadcasts changes, allowing the file tree and
   selected file to refresh when safe.
6. Managed `.env` content is stored in the host database and also synced into
   the sandbox as `/workspace/project/.env`.

### Value

The file editor gives the user a repair lane. It also makes agent work legible:
the changed-file markers show what moved, while the editor lets the user inspect
or patch specific files immediately.

### Workflow Constraint

The lock during agent turns is a key product decision. It prevents the user and
agent from writing the same filesystem concurrently, which keeps the chat,
file tree, and commit outcomes coherent.

## Workflow 6: Library

### Customer Intent

The user wants reusable agent behavior, skills, and workflow presets rather
than re-explaining the same operating mode in every project.

### User Experience

The Library surface supports:

- Creating item shells for agents, skills, and workflow presets.
- Editing metadata such as name, description, slug, and tags.
- Publishing immutable revisions.
- Archiving items.
- Exporting and importing library bundles.
- Selecting published workflow presets from project chat when using the
  compatible OpenHands path.

### End-To-End Flow

1. A user creates a library item.
2. They publish revisions with content and typed config.
3. A workflow preset resolves enabled skill and agent revisions into a snapshot.
4. When selected for a run, the snapshot is stored against the session runtime
   state and agent run.
5. The selected preset can contribute model choice, tools, skills, agents, and
   remote mode metadata to the runtime prompt/context.

### Value

The library turns one-off agent instructions into reusable operational assets.
It is the difference between "prompt crafting in a chat box" and "versioned
workflows that can be applied to a session."

### Operational Leverage

Revision snapshots are important. A run references the library content as it
existed at the time of use, so later edits do not rewrite the meaning of past
runs.

## Workflow 7: Agent Configuration

### Customer Intent

The user or workspace owner wants to define how agents should behave globally,
then override or refine behavior per project.

### Global Configuration

The Agent config page manages:

- Workspace `AGENTS.md`.
- Workspace skills.
- Workspace file-based agents.
- Enablement states.
- Effective config preview.

### Project Configuration

Inside a project, the agent-config side panel adds:

- Project mode: Inherit, Extend, or Replace.
- Project-specific `AGENTS.md`.
- Project-level skill enablement overrides.
- Project-level file-agent enablement overrides.
- Effective config preview.
- Materialized file list.

### End-To-End Flow

1. Workspace configuration is stored in database-backed definitions.
2. A project resolves global and project settings into an effective config.
3. Effective OpenHands-compatible files are materialized into the sandbox at
   project spawn or restart.
4. Saving project config while the sandbox is live also tries to sync those
   materialized files immediately.
5. If live sync fails, the saved database config remains authoritative and a
   restart reapplies it.

### Value

This moves agent behavior out of scattered prompt memory and into a managed
configuration workflow. Teams can establish defaults while still letting a
specific project override the rules of engagement.

## Workflow 8: History, Commits, And Pull Requests

### Customer Intent

The user wants confidence that agent changes are traceable and deliverable.
They need to see what changed, review diffs, and for GitHub projects, push the
work toward a pull request.

### User Experience

The History tab provides:

- A commit list with short SHA, title, changed file count, insertions,
  deletions, runtime, model, and time.
- Commit details with body message and runtime metadata.
- File-level diff loading through the broker.
- Pagination for older commits.

For GitHub-sourced projects, the workspace header adds:

- Pull request status refresh.
- Create pull request action when there are workspace changes.
- Open pull request link after creation.

### End-To-End Flow

1. At the end of an agent run, the broker checks Git status.
2. If there are changes, it creates a commit with an agent author and a message
   derived from the prompt plus runtime/model/run metadata.
3. The host stores commit metadata and prepends it to the workspace history.
4. The history UI can ask the broker for commit file lists and diffs.
5. For GitHub projects, the host asks the sandbox broker for Git status.
6. Creating a pull request commits and pushes workspace changes to a working
   branch, then opens a GitHub pull request against the original base branch.

### Value

This is one of the strongest workflow shifts in the product. Agent work is not
just applied to files; it is packaged into reviewable commits. For imported
repositories, the path from chat request to GitHub pull request is integrated
into the same screen.

### Operational Leverage

- GitHub App installation tokens are used for clone and push operations.
- Push credentials are kept out of visible output.
- Pull request creation is blocked while a project run is active.
- No-change states are explicit, avoiding empty PRs.

## Workflow 9: Usage And Cost Awareness

### Customer Intent

The user wants to understand model usage, cost, and activity by project.

### User Experience

The Usage page rolls up:

- Total cost.
- Total tokens.
- Turns.
- Projects.
- Per-project cost, token totals, cache write/read, and turn counts.
- Recent turn-level usage.

### Value

Usage reporting turns agent activity into a managed resource. That matters for
teams because the product is not simply running background automation; it is
spending model tokens on behalf of projects.

## Workflow 10: Admin Worker Operations

### Operator Intent

The operator wants reliable sandbox capacity and a way to manage failures
without directly manipulating cloud VMs or Docker containers.

### Admin Worker Surface

The worker admin UI supports:

- Fleet summary: ready workers, draining workers, used slots, total capacity.
- Worker creation with name, region, server type, and capacity.
- Worker list with status, provider, VM id, Tailnet IP, hostname, heartbeat,
  ready time, provisioning error, and slot usage.
- Drain action.
- Retry failed provisioning.
- Decommission when draining and empty.
- Refresh all.

### End-To-End Flow

1. An admin creates a worker. In the Hetzner path, provisioning creates a VM,
   joins it to the private network/Tailnet, and records capacity.
2. Worker-agent heartbeats update readiness and last heartbeat.
3. Project creation asks the scheduler for a ready worker with available slots.
4. If no worker has capacity and auto-provisioning is enabled, the runtime can
   provision another worker.
5. Draining removes a worker from new placement while existing sandboxes finish.
6. Decommissioning destroys the provider worker only after active slots are
   gone.
7. Retry handles failed provisioning by decommissioning the failed record and
   creating a replacement with the same basic shape.

### Orphan Sandbox Cleanup

The dashboard also exposes orphan sandbox cleanup. It compares Docker sandboxes
reported by the worker-agent with database-managed sandbox records, then lets
an operator remove untracked containers.

### Value

The admin workflow makes capacity visible as product infrastructure. A user sees
"Create project"; the operator sees the fleet mechanics that make project
creation reliable. The slot model, heartbeat, broker-ready callback, drain, and
decommission flows are the leverage that let many isolated project workspaces
run without hand-managed machines.

## Cross-Workflow Patterns

### Durable State Over Live Socket Assumptions

The product uses live WebSockets for immediate workspace interaction, but it
does not rely on them as the source of truth for agent progress. Runs, events,
messages, runtime states, usage, and commits are persisted by the host. This
lets the browser poll and replay state after reconnects.

### Sandbox As The Unit Of Work

The sandbox is the center of the product. Preview, file operations, terminal,
agent execution, Git status, commits, and pull request pushes all happen against
the same `/workspace/project` root. That makes the product feel like an IDE,
not a disconnected chat tool.

### Runtime Choice Without Workflow Forking

The UI exposes active runtime options and preserves historical runtime labels.
The run queue, session state, usage, and commit history can carry runtime/model
metadata without making the user learn a different workflow per runtime.

### Human And Agent Collaboration Boundaries

The human can inspect and edit code, but writes are locked while the agent is
active. The agent can modify files, but its work is surfaced through changed
markers, stream activity, commit metadata, and preview feedback.

### Managed Instructions As Product Configuration

Agent instructions are not just free text in a prompt. They exist at workspace,
project, library, and session levels, then materialize into sandbox files or run
snapshots. This gives the product a route to repeatable agency.

## Highest-Leverage Workflow Bets

1. Keep shortening the intent-to-preview loop.
   The strongest customer value is asking for a change, seeing the live site
   update, capturing feedback, and asking for the next correction without
   leaving the workspace.

2. Make history the trust layer.
   Commits, diffs, runtime metadata, and token/cost footers are how users audit
   agent work. The more legible this layer is, the easier it is to trust larger
   tasks.

3. Treat library and agent config as reusable operations.
   The product becomes more valuable when teams can define durable workflows
   rather than repeating prompts in every project.

4. Preserve the operator mental model.
   Worker slots, readiness, heartbeat, drain, decommission, and orphan cleanup
   are not secondary implementation details. They are what let the customer
   workflow scale without exposing infrastructure complexity to builders.

5. Keep GitHub import and pull requests central.
   Template projects prove the loop, but GitHub-backed projects connect the
   product to real work. The import-to-PR path is where Daytona becomes part of
   an existing development process rather than an isolated builder.

## Workflow Map Summary

Project creation/import converts a source into a running sandbox. Opening the
workspace waits for broker readiness and socket connectivity. Chat creates
durable agent runs against a per-project queue. The broker executes those runs
inside the same project root that powers preview, file editing, terminal, and
Git. The user inspects output through preview, console, code, history, and
usage. Library and agent config turn repeated behavior into versioned or
inherited assets. Admin worker operations keep the sandbox fleet healthy enough
that the whole flow feels like a product action instead of infrastructure work.
