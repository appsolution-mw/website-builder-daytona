# Feature Inventory

This inventory describes the product capabilities visible in the current codebase, grouped by the value they create rather than by implementation area.

## Buyer-Visible Capabilities

### Project Dashboard And Sandbox Creation

Customers can create and reopen isolated website builder projects from a central dashboard. Projects can start from a clean template or from a connected GitHub repository and branch.

Customer outcome: users get a dedicated, disposable working environment for each website or feature initiative, without setting up local development tools.

Why it matters: this lowers the activation barrier. A buyer can move from idea to editable live project quickly, while keeping experiments separated from production work.

### GitHub Repository Import

The product can connect to a GitHub App installation, list repositories, load branches, and create projects from selected repositories.

Customer outcome: teams can work on real existing codebases rather than only generated starter projects.

Why it matters: this turns the product from a toy builder into a workflow that can sit beside an existing engineering or marketing site.

### Chat-Driven Website Editing

Inside a project, users prompt an agent to make changes. The chat streams agent progress, messages, tool activity, errors, and completion metadata.

Customer outcome: users can describe the desired site change in natural language and watch the system do the work.

Why it matters: this is the core value proposition. It lets less technical stakeholders request meaningful website updates while still giving technical users visibility into what happened.

### Multi-Runtime Agent Choice

The workspace supports selectable agent runtimes, currently exposing Claude Code and Codex in the UI, with OpenHands still represented for existing sessions and workflow presets.

Customer outcome: users can choose the agent engine that best fits a task, organization preference, or model availability.

Why it matters: model and runtime flexibility reduces vendor lock-in and gives the product a path to support different quality, cost, and latency tradeoffs.

### Model Selection

Supported runtimes expose model pickers. Claude Code uses a curated Claude model list, and OpenRouter-backed flows can load text-and-image-capable tool-use models.

Customer outcome: users can choose stronger, cheaper, or larger-context models per session.

Why it matters: buyers care about both output quality and spend control. Model choice makes the product adaptable to lightweight edits and heavier design or refactor work.

### Multi-Session Project Chat

Each project can have multiple chat sessions, with persisted session history, default runtimes, message counts, and per-runtime resume state.

Customer outcome: users can split work into separate conversations, revisit prior context, and continue a project without losing the agent's state.

Why it matters: website work is iterative. Persistent sessions make the product useful for ongoing projects instead of one-off prompt runs.

### Visual Context Through Image Attachments

Users can paste, drag, or attach images to chat prompts. The workspace also supports capturing a selected region of the live preview and attaching it as image context.

Customer outcome: users can point at visual issues, screenshots, mockups, or preview regions instead of trying to describe every detail in text.

Why it matters: website-building feedback is often visual. Image context makes design iteration faster and more precise.

### Live Preview With Device Frames

Projects expose a live preview in the workspace. Users can switch preview framing between desktop, tablet, and mobile sizes and open the preview in a separate tab.

Customer outcome: users can immediately see the site that the agent or editor changed across common viewport classes.

Why it matters: live preview closes the feedback loop. Responsive checks are especially important for buyer confidence in marketing and public-facing pages.

### In-Browser Code Editor

The workspace includes a file tree and Monaco-based code editor with save status, dirty indicators, language detection, and read-only locking while an agent is editing.

Customer outcome: technical users can inspect and directly adjust code without leaving the product.

Why it matters: a serious builder must support escape hatches. Direct code editing makes agent output auditable and correctable.

### Workspace Terminal

Users can open an interactive terminal connected to the project sandbox, with status, stop, reconnect, and clear controls.

Customer outcome: developers can run commands, inspect the environment, and debug project behavior in place.

Why it matters: terminal access makes the product viable for real development work, not just guided generation.

### Preview Console

The workspace captures browser console output from the preview and displays logs, warnings, errors, timestamps, and page paths.

Customer outcome: users can see runtime errors and browser-side diagnostics while editing.

Why it matters: web issues often show up only in the browser. Surfacing console output reduces debugging friction.

### Commit History And Diff Inspection

Agent turns can create commits. The history view lists commits with changed files, insertions, deletions, runtime/model metadata, commit messages, and per-file diffs.

Customer outcome: users can understand exactly what changed after each agent run.

Why it matters: this builds trust. Buyers need traceability before letting an AI agent change production-bound code.

### GitHub Pull Request Handoff

For GitHub-backed projects, users can check whether there are changes and create a pull request from the workspace.

Customer outcome: teams can move agent-produced changes into their normal code review process.

Why it matters: PR handoff connects the builder to existing engineering governance, making adoption easier in teams that already use GitHub.

### Project Environment Variables

Each project can store environment content and sync it into the sandbox `.env` file, with size limits and sync warnings.

Customer outcome: users can configure API keys, feature flags, and runtime settings needed by the project.

Why it matters: most real websites depend on configuration. Environment management helps projects behave like production-like apps instead of static demos.

### Agent Configuration Per Project

Users can edit project-specific AGENTS.md content, choose inheritance behavior, enable or disable skills and file agents, and preview the materialized files that will be applied to the sandbox.

Customer outcome: users can tailor agent behavior for a specific project without changing global defaults.

Why it matters: agent quality depends on context. Per-project configuration lets teams encode local conventions, constraints, and workflow expectations.

### Reusable Library Of Skills, Agents, And Workflow Presets

Users can create library items for skills, agents, and workflow presets; publish immutable revisions; edit metadata; archive items; roll back revisions; and import/export library content.

Customer outcome: teams can package successful agent instructions and workflows for reuse.

Why it matters: repeatability is what turns prompt experimentation into an operating system for website work.

### Workflow Presets

Published workflow presets can bundle runtime/model preferences, enabled skills, enabled agents, tool settings, and remote execution mode. The workspace can select presets for OpenHands-backed sessions.

Customer outcome: users can launch a known workflow for a class of tasks instead of manually reconfiguring agent behavior each time.

Why it matters: presets make complex agent setups approachable and help teams standardize quality.

### Token And Cost Usage Dashboard

The usage dashboard summarizes total cost, tokens, turns, cache write/read tokens, output tokens, project-level usage, and recent turns.

Customer outcome: buyers can see where AI spend is going across projects.

Why it matters: AI cost visibility is a buying requirement for teams. It supports budget control and operational accountability.

## Admin And Operational Capabilities

### Project Lifecycle Management

The dashboard shows running, provisioning, archived, and destroyed project states. Users can delete projects and destroy their containers.

Customer outcome: operators can clean up workspaces and understand which projects are active or unavailable.

Why it matters: sandbox resources have real cost. Lifecycle controls keep the system manageable as project count grows.

### Sandbox Restart

Users can restart a running sandbox from the workspace. The UI clears stale file and preview state, reconnects to the broker, and reloads the project snapshot.

Customer outcome: users can recover from broken or stale runtime state without creating a new project.

Why it matters: long-lived development containers fail in ordinary ways. Restart is a practical reliability feature.

### Orphan Sandbox Cleanup

The dashboard can list and remove orphan sandboxes that no longer map cleanly to active project state.

Customer outcome: operators can reclaim stuck or leaked runtime resources.

Why it matters: container cleanup protects margins and keeps developer environments predictable.

### Worker Pool Administration

The admin worker screen lists workers, capacity, used slots, free slots, readiness, heartbeat recency, provider metadata, provisioning errors, and lifecycle state. Admins can create, refresh, drain, retry, or decommission workers.

Customer outcome: platform operators can manage the fleet that hosts project sandboxes.

Why it matters: this is essential for scaling beyond a single host. It gives operations teams control over cost, capacity, and reliability.

### Managed Hetzner Worker Provisioning

The runtime layer supports a managed worker-pool mode that can provision Hetzner workers, place sandboxes on workers with capacity, and route project previews.

Customer outcome: the product can grow capacity automatically instead of depending on one local machine.

Why it matters: buyers expect hosted software to absorb demand. Managed workers are the path from local prototype to production service.

### Local Worker Mode

The runtime can also target a locally running worker-agent.

Customer outcome: developers and operators can validate the full sandbox flow without cloud provisioning.

Why it matters: local mode lowers operational risk during development and testing.

### Worker Heartbeats And Broker Readiness

Worker agents report health and sandbox broker readiness back to the host. The UI waits for broker readiness before mounting the workspace.

Customer outcome: users see fewer broken workspaces and less connection noise during startup.

Why it matters: clear readiness signaling makes the system feel reliable even when containers take time to boot.

### HMAC-Protected Worker Control Plane

Worker-agent endpoints use timestamped HMAC verification for non-health routes, including sandbox creation, queue execution, git operations, and cancellation.

Customer outcome: host-to-worker commands are authenticated rather than open to arbitrary callers.

Why it matters: sandbox infrastructure can execute code and manipulate repositories. Control-plane authentication is foundational security.

### Queue Execution And Recovery

Agent runs are queued per project, executed one at a time, and tracked through attempts. Failed runs can block the queue, and users can retry or skip blocked runs.

Customer outcome: users can submit follow-up prompts while work is running, and recover when a run fails.

Why it matters: queueing protects project state from concurrent agent edits while preserving a smooth chat experience.

### Run Cancellation

Users can abort an active run, and worker-agent routes can forward cancellation to the broker.

Customer outcome: users can stop expensive or mistaken work quickly.

Why it matters: cancellation is both a cost-control and safety feature.

### Durable Run Events

Agent run events are persisted with ordered per-project sequence numbers and replayed to the workspace.

Customer outcome: users can reload the page and still see active or recent run progress.

Why it matters: durable event history makes the product robust across browser refreshes and transient WebSocket interruptions.

### Usage Persistence

The WebSocket proxy records token usage events for coder, reviewer, and aggregate turn labels, including duration, token classes, cache tokens, request counts, model metadata, and cost.

Customer outcome: usage reporting reflects actual streamed agent runs rather than manual estimates.

Why it matters: reliable metering supports pricing, billing, quota enforcement, and spend analytics.

## Collaboration And Control Capabilities

### Workspace Membership Model

The database includes workspaces, workspace members, and member roles. Project access checks allow ownership or workspace membership.

Customer outcome: projects can be shared within a team boundary rather than tied only to a single user.

Why it matters: website work is usually collaborative. Workspace membership is the base layer for team adoption.

### Authenticated User Accounts

The app includes sign-in, authenticated sessions, account records, and server-side user checks around project, library, GitHub, and admin routes.

Customer outcome: users see and manage their own projects and assets.

Why it matters: authentication is required for privacy, multi-tenant data separation, and future billing or permissions.

### GitHub App Installation Ownership

GitHub installations and repositories are stored per user and checked before import, branch listing, or PR creation.

Customer outcome: users only work with repositories they have connected.

Why it matters: repository access is sensitive. Ownership checks make GitHub integration enterprise-safe in principle.

### Agent Busy Locks

The UI disables file saves, environment saves, agent config saves, terminal use, and some PR/restart actions while an agent turn is active.

Customer outcome: users avoid conflicting edits during agent execution.

Why it matters: concurrency control reduces corrupted workspaces and confusing race conditions.

### Effective Agent Configuration Preview

Workspace-level and project-level agent configuration screens show the effective AGENTS.md, enabled skills, enabled agents, and materialized sandbox files.

Customer outcome: users can see what instructions the agent will actually receive.

Why it matters: agent configuration can be opaque. Preview improves trust and helps teams debug behavior.

### Inheritance Modes For Project Instructions

Project agent config supports inherit, extend, and replace modes relative to workspace defaults.

Customer outcome: teams can decide whether a project follows global rules, adds local guidance, or opts out of workspace instructions.

Why it matters: different projects often need different degrees of autonomy while still benefiting from organizational standards.

### Immutable Library Revisions

Library revisions are versioned, checksummed, publishable, rollbackable, and import/export-aware.

Customer outcome: teams can evolve reusable prompts and workflows without losing prior working versions.

Why it matters: controlled revision history is important when instructions become shared operational assets.

### Pull Request Review Boundary

GitHub-backed projects do not push directly to the base branch. They push to a working branch and open a pull request.

Customer outcome: agent changes enter normal code review instead of bypassing team process.

Why it matters: this makes the product compatible with engineering governance and reduces perceived AI risk.

### Commit-Level Accountability

Commits include author kind, runtime, model id, summary, file counts, insertions, deletions, and a link back to the agent run where available.

Customer outcome: teams can trace a change back to who or what made it.

Why it matters: auditability is critical when AI agents modify production-bound repositories.

## Hidden Platform Capabilities

### Isolated Docker Sandbox Runtime

Each project runs in a Docker-based sandbox with a broker, preview server, file system access, git operations, terminal access, and agent execution surfaces.

Customer outcome: user projects run in isolated environments rather than contaminating the host or one another.

Why it matters: isolation is the foundation for running untrusted project code and AI-generated commands safely.

### Broker Protocol

The host, WebSocket proxy, browser, and sandbox broker share a typed protocol for agent prompts, aborts, file operations, terminal sessions, file-change notifications, git commits, policy violations, and usage.

Customer outcome: users experience one coherent workspace even though work is split across browser, host, proxy, worker, and container.

Why it matters: a strong protocol boundary lets the platform evolve runtimes without rewriting the UI.

### WebSocket Proxy

The proxy resolves a project to its broker URL, buffers early browser messages, forwards browser and broker traffic, maintains keepalive pings, and records token usage from streamed events.

Customer outcome: the browser can interact with sandbox brokers through a stable project route.

Why it matters: the proxy hides sandbox networking complexity and supports long-running agent turns.

### Worker-Agent Control API

The worker-agent creates and destroys sandbox containers, exposes sandbox status, forwards queue execution and git commands into the broker, and streams run execution responses.

Customer outcome: projects can be hosted on remote workers while still feeling local to the app.

Why it matters: this is the bridge between SaaS control plane and actual compute.

### Port And Route Management

Worker sandboxes receive broker and preview ports. Runtime code can also create and delete public project preview routes.

Customer outcome: each project gets a reachable preview and broker connection.

Why it matters: multi-project hosting requires deterministic routing to many independent containers.

### Runtime Provider Abstraction

The sandbox broker chooses an agent provider for Claude Code, Codex, or OpenHands and normalizes run events into the shared protocol.

Customer outcome: users can switch between agent engines without learning separate product workflows.

Why it matters: runtime abstraction protects the product from fast-changing AI provider APIs.

### Claude Agent SDK Runner

Claude Code turns can be forwarded to an in-container agent-runner over an HMAC-protected local HTTP bridge, with replay context, attachments, model selection, and event callbacks.

Customer outcome: Claude-powered sessions can resume and operate with project-specific context.

Why it matters: high-quality agent execution depends on session continuity and secure local orchestration.

### Attachment Normalization

Image attachments are converted, validated, size-limited, persisted with user messages, and adapted differently for Claude Code, Codex, and OpenHands.

Customer outcome: visual prompts work consistently across runtimes.

Why it matters: multimodal support is valuable only if each runtime receives attachments in the format it can use.

### Automatic Commit Hook

After non-aborted agent runs, the broker checks the working tree and creates a commit when there are actual changes, or emits a no-change/commit-failed event.

Customer outcome: users get a clean change record without manually committing after every agent turn.

Why it matters: automatic commits convert agent activity into reviewable engineering artifacts.

### Git Status And Push Bridge

The worker-agent can forward git status and git push commands into the sandbox broker, enabling PR status checks and GitHub branch updates.

Customer outcome: GitHub handoff uses the actual sandbox working tree.

Why it matters: PR creation is only trustworthy when it pushes the code users previewed and inspected.

### Policy Hooks For Agent Safety

The Claude agent-runner blocks destructive bash patterns and file writes outside `/workspace`, and emits policy violation events with redacted inputs.

Customer outcome: dangerous operations are stopped before they mutate sensitive paths.

Why it matters: guardrails are mandatory when agents can run shell commands and edit files.

### Managed Agent File Materialization

Workspace and project instructions, skills, and file agents are resolved into concrete files inside the sandbox.

Customer outcome: agent behavior configured in the UI becomes real runtime context automatically.

Why it matters: this closes the gap between high-level configuration and what the agent actually sees.

### Environment Injection

Project environment content is stored in the host database, passed into sandbox creation, and synced to `.env` during editing.

Customer outcome: project configuration survives sandbox restarts and can be applied at launch.

Why it matters: durable environment management keeps sandbox behavior consistent.

### Public Slug Generation

Projects receive unique public slug candidates derived from project names.

Customer outcome: previews can have stable, human-readable routes.

Why it matters: readable preview URLs are easier to share, inspect, and operate.

### Broker Readiness Watcher

Worker-agent startup watches for the broker to become reachable and reports readiness to the host.

Customer outcome: the workspace opens only after the sandbox can actually respond.

Why it matters: readiness checks prevent broken first impressions and reduce support noise.

### Capacity-Aware Scheduling

Worker-pool runtime reserves sandbox slots transactionally and retries worker selection when capacity races occur.

Customer outcome: projects are assigned to available workers without oversubscribing capacity.

Why it matters: capacity control protects platform reliability as concurrent users increase.

### Sanitized Provisioning Errors

Project creation maps low-level agent and worker errors into safer user-facing provisioning messages.

Customer outcome: users receive understandable failure states without leaking sensitive infrastructure details.

Why it matters: good error boundaries improve supportability and reduce accidental exposure of secrets or internals.
