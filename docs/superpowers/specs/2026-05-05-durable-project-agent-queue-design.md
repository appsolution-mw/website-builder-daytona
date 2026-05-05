# Durable Project Agent Queue Design

Date: 2026-05-05
Status: Implemented
Task: T-20260505-010

## Goal

Build a durable, project-level agent execution queue for customer workspaces.
Each project may have only one running agent task at a time. Additional
messages are persisted and queued, then executed in FIFO order after the active
task completes. Agent tasks must continue running when the browser closes, and
chat streams must be replayable after reconnect.

## Confirmed Product Decisions

- V1 uses the existing worker-pool/Daytona architecture with a durable
  project-run orchestrator.
- One project has one FIFO queue shared by all chat sessions in that project.
- A running task is never steered by later messages in V1.
- Messages submitted during a running task become queued follow-up runs.
- Queue processing continues automatically after successful runs.
- A failed or cancelled run blocks the project queue until a user confirms what
  should happen next.
- Failed runs are retryable.
- Retry uses the current project filesystem state, not an automatic rollback to
  a pre-run snapshot.
- Data persistence is a core requirement, not a best-effort enhancement.

OpenAI Codex behavior informed the queue decision: Codex supports mid-turn
steering, but also updated follow-up behavior to queue by default. This project
will intentionally implement only queued follow-ups in V1 for simpler and more
predictable customer behavior.

## Existing Constraints

Today the browser owns too much of the turn lifecycle:

- `app/project/[id]/page.tsx` sends `agent.prompt` directly over WebSocket.
- The sandbox broker executes the turn inline for the current socket.
- Agent chunks are assembled in React state.
- Agent messages are persisted by the browser after `agent.done`.
- Closing the browser can lose live stream state and must not be treated as a
  reliable background execution boundary.

The V1 design moves execution ownership to a server-side queue/orchestrator.
The browser becomes a producer of queued work and a subscriber to persisted
events.

## Data Model

### Workspace

Add a real `Workspace` model for customer tenancy.

Recommended fields:

- `id`
- `name`
- `createdAt`
- `updatedAt`

Add a membership model:

- `WorkspaceMember`
- `workspaceId`
- `userId`
- `role`: `OWNER`, `ADMIN`, `MEMBER`

Move projects under workspaces:

- `Project.workspaceId`
- keep `Project.ownerId` during migration as a compatibility field until the UI
  and access checks are workspace-aware.

### AgentRun

Represents the durable user request. A run belongs to exactly one project and
one chat session.

Recommended fields:

- `id`
- `projectId`
- `sessionId`
- `userMessageId`
- `status`: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`
- `runtime`
- `providerSessionId`
- `modelId`
- `queueSequence`: monotone per project
- `queuedAt`
- `startedAt`
- `finishedAt`
- `blockedReason`
- `lastAttemptNumber`
- `createdById`

Indexes:

- `[projectId, status, queueSequence]`
- `[sessionId, createdAt]`
- unique `[projectId, queueSequence]`

### AgentRunAttempt

Represents one concrete execution attempt. Retrying a failed run creates a new
attempt for the same `AgentRun`.

Recommended fields:

- `id`
- `runId`
- `attemptNumber`
- `status`: `STARTING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`
- `startedAt`
- `finishedAt`
- `exitCode`
- `errorMessage`
- `baseCommitSha`
- `gitStatusBefore`
- `gitDiffStatBefore`
- `providerConversationId`
- `providerResumeState`

Indexes:

- unique `[runId, attemptNumber]`

### AgentRunEvent

Append-only event log for replay and audit.

Recommended fields:

- `id`
- `runId`
- `attemptId`
- `projectId`
- `sessionId`
- `sequence`: monotone per project
- `type`: `STATUS`, `CHUNK`, `TOOL_USE`, `USAGE`, `DONE`, `ERROR`, `FILE_CHANGED`
- `agentId`
- `payload`
- `createdAt`

Indexes:

- unique `[projectId, sequence]`
- `[runId, sequence]`
- `[sessionId, sequence]`

### ProjectQueueState

Stores project-level execution state.

Recommended fields:

- `projectId`
- `state`: `IDLE`, `RUNNING`, `BLOCKED`
- `activeRunId`
- `blockedRunId`
- `blockedAt`
- `updatedAt`

This can be a separate model or fields on `Project`; a separate model keeps
queue locking and lifecycle code easier to reason about.

## Queue Semantics

### Enqueue

Submitting a prompt calls a Host API, not the sandbox broker directly:

```text
POST /api/projects/:projectId/runs
```

The API transaction:

1. Verifies workspace/project access.
2. Creates `Message(USER)`.
3. Allocates the next project `queueSequence`.
4. Creates `AgentRun(QUEUED)`.
5. Emits a durable `AgentRunEvent(STATUS queued)`.
6. Signals the project queue drain.

If another run is active, enqueue still succeeds. The message is visible in its
chat session as queued.

### Drain

The orchestrator processes one project at a time:

1. Acquire a project-level DB lock or equivalent advisory lock.
2. If `ProjectQueueState=BLOCKED`, stop.
3. If an active run exists, stop.
4. Pick the oldest `AgentRun(QUEUED)` by `queueSequence`.
5. Mark it `RUNNING`.
6. Create `AgentRunAttempt`.
7. Execute the provider turn.
8. Persist every provider event before broadcasting it.
9. On success, mark attempt and run `SUCCEEDED`.
10. Persist the final `Message(AGENT)`.
11. Start the next queued run.

### Failure

On provider error, timeout, sandbox error, or explicit cancel:

1. Mark attempt `FAILED` or `CANCELLED`.
2. Mark run `FAILED` or `CANCELLED`.
3. Set `ProjectQueueState=BLOCKED`.
4. Persist an `AgentRunEvent(ERROR)`.
5. Do not start the next queued run.

New user messages may still be queued while blocked, but they do not execute.

### Retry

Retry is explicit:

```text
POST /api/projects/:projectId/runs/:runId/retry
```

The API:

1. Verifies the run belongs to the blocked project.
2. Creates a new `AgentRunAttempt`.
3. Sets the run back to `RUNNING`.
4. Clears the project blocked state.
5. Executes from the current workspace state.

No automatic rollback occurs in V1. The attempt records git status before each
attempt so later UI can explain what changed.

### Skip

Skip is explicit:

```text
POST /api/projects/:projectId/runs/:runId/skip
```

The API leaves the failed run failed, clears the blocked queue state, and drains
the next queued run.

## Streaming And Reconnect

The browser subscribes to persisted events. WebSocket delivery is a live
transport only; it is not the source of truth.

Required APIs:

```text
GET /api/projects/:projectId/runs
GET /api/projects/:projectId/events?after=<sequence>
GET /api/projects/:projectId/sessions/:sessionId
```

Reconnect flow:

1. Browser loads project snapshot.
2. Browser loads session messages.
3. Browser loads active and queued runs.
4. Browser loads `AgentRunEvent` rows after the last known sequence.
5. Browser opens WebSocket subscription for new project events.

Every live event must be written to `AgentRunEvent` before it is broadcast. If
the socket drops, replay fills the gap.

## Browser Behavior

During a running task:

- Composer remains enabled.
- Primary submit label becomes `Queue message`.
- Sending creates a queued run, not a steer message.
- The queued message appears immediately in its session.
- Project header shows active run and queue count.

When the current session is not the running run's session:

- The session can still enqueue messages.
- The project-level queue indicator shows the active session/run.
- The queued session shows pending status until its turn starts.

When the project is blocked:

- Show a blocking banner.
- Provide `Retry failed run` and `Skip failed run`.
- Keep enqueue enabled, but label queued messages clearly as waiting behind a
  blocked run.

## OpenHands Persistence

OpenHands must use SDK conversation persistence rather than relying only on a
generated `providerSessionId`.

Bridge changes:

- Add `--conversation-id`.
- Add `--persistence-dir`.
- Use a project-scoped persistence directory such as
  `.agent-artifacts/openhands/conversations`.
- Store OpenHands resume metadata in `SessionRuntimeState.resumeState` and/or
  `AgentRunAttempt.providerResumeState`.

For follow-up runs in the same chat session, the orchestrator passes the same
conversation identity for the session/runtime pair. For retry attempts, the
attempt gets its own event log while continuing from the current workspace and
the same persisted conversation context unless a later design introduces manual
conversation forking.

## Broker And Worker Changes

The broker should no longer treat a single WebSocket connection as the owner of
an agent turn.

V1 should introduce a run executor boundary:

```ts
interface AgentRunExecutor {
  executeRun(runId: string, attemptId: string, signal: AbortSignal): Promise<void>;
}
```

The executor owns:

- provider selection
- prompt construction
- attachment manifest handling
- provider event mapping
- event persistence
- usage persistence
- final message persistence

The WebSocket server owns only:

- subscriptions
- terminal/file commands
- live event broadcast

If the sandbox broker remains the process that executes provider code, the Host
or worker-agent must be able to trigger queue draining over a durable HTTP
command, not only over a browser WebSocket message.

## Cancellation

Browser disconnect never cancels work.

Cancellation requires an explicit API:

```text
POST /api/projects/:projectId/runs/:runId/cancel
```

Cancel marks the active attempt cancelled, stops the provider process, and
blocks the project queue until the user chooses retry or skip.

## Security And Tenancy

All queue, run, event, and session APIs must check workspace membership and
project access.

Secrets must not be stored in event payloads. Event payloads should redact:

- environment variable values
- API keys
- GitHub installation tokens
- raw process env
- file contents from hidden secret files

Provider subprocesses should receive a minimal environment instead of the full
host or broker environment wherever practical.

## Migration Plan

1. Add workspace models and project workspace ownership.
2. Add run, attempt, event, and queue-state models.
3. Add enqueue, retry, skip, cancel, and event replay APIs.
4. Add queue-drain service with project-level locking.
5. Move browser prompt submit from WebSocket to Host API.
6. Change broker execution to run under `AgentRunExecutor`.
7. Persist events before broadcasting.
8. Hydrate client UI from messages, runs, and event replay.
9. Persist final agent messages server-side.
10. Add OpenHands conversation persistence.
11. Remove client-side agent-message persistence.

Each step should include focused tests. Runtime changes need broker tests and
host API tests. DB-backed tests must use `TEST_DATABASE_URL`.

## Non-Goals For V1

- Mid-turn steering.
- Parallel runs within one project.
- Automatic rollback before retry.
- Best-of-N execution.
- Remote Agent Server migration.
- Cross-project queue scheduling.
- Billing or quota enforcement beyond preserving existing token usage records.

## Open Questions For Later

- Whether automatic rollback should become a paid or admin-only feature.
- Whether Remote Agent Server should become an alternate execution mode after
  the durable local queue is stable.
- Whether queued runs should support priority changes.
- Whether workspace-level concurrency limits should be configurable per plan.
