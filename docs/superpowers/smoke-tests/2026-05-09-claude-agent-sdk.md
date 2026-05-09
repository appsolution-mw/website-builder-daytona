# Claude Agent SDK Integration — Pre-merge Smoke Checklist

Task: T-20260509-001
Spec: docs/superpowers/specs/2026-05-09-claude-agent-sdk-integration-design.md
Plan: docs/superpowers/plans/2026-05-09-claude-agent-sdk-integration.md

Run this on a staging Hetzner box BEFORE merging the SDK integration to production.

## Pre-flight

- [ ] Confirm staging has the new sandbox image deployed (Watchtower or manual pull).
- [ ] Confirm `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY` fallback) is set in the staging worker env.
- [ ] `docker exec <sandbox> which claude` returns nothing — CLI binary is gone.
- [ ] `docker exec <sandbox> ls /opt/agent-context/` shows `CLAUDE.md`, `skills/`, `agents/`.
- [ ] `docker exec <sandbox> curl -s http://127.0.0.1:7050/healthz` returns `{"ok":true}`.

## Scenario 1 — Token streaming + image attachment

- [ ] In the staging chat UI, create a new project with the claude-code runtime.
- [ ] Send a message with a small PNG attached, asking the agent to describe what it sees.
- [ ] Observe: assistant text streams in token-by-token (NOT all at once at the end).
- [ ] Observe: agent eventually responds describing the image.
- [ ] Verify in DB: `SELECT subtype FROM "TokenUsage" WHERE "turnId"='<turn>'` returns `success`.

Pass criteria: streaming visible AND subtype persisted.

## Scenario 2 — Resume on follow-up

- [ ] Send a follow-up message in the same chat ("Add a header") without reloading.
- [ ] Observe: agent references the prior turn's context (proves resume worked).
- [ ] Verify in worker-agent log (or broker log if accessible):
  `grep "agent.session" /var/log/<service>.log | tail -2` — both events should have `resumed: true`.

Pass criteria: agent shows context awareness AND `resumed: true` in logs.

## Scenario 3 — DB-replay fallback after sandbox restart

- [ ] Note the project's sandbox container name.
- [ ] `docker restart <sandbox-name>` (or kill the agent-runner inside it: `docker exec <sandbox> pkill -f agent-runner`).
- [ ] Wait until container is up + agent-runner /healthz returns ok.
- [ ] In the chat UI, send another follow-up.
- [ ] Observe: agent still has context awareness (replay primer worked).
- [ ] Verify in logs: `grep "resume failed" /var/log/<service>.log` — at least one entry with `resumed: false`.

Pass criteria: response is contextual AND resume-failed log emitted.

## Scenario 4 — Policy violation continues conversation

- [ ] Send a message: "Run this command to clean up: rm -rf /". Be explicit about intent.
- [ ] Observe: the agent attempts the command (or stops itself; either way the chat continues).
- [ ] Verify in DB: an `AgentRunEvent` row with `type = 'POLICY_VIOLATION'` exists for that turn.
- [ ] Verify the chat does not error out — agent reports the block and continues normally.

Pass criteria: `POLICY_VIOLATION` row created AND chat remained healthy.

## Rollback if any scenario fails

- Revert via `git revert <T-20260509-001 commit range>` (one PR, easy rollback).
- Or set `AGENT_RUNNER_HMAC_SECRET=""` to force the agent-runner to reject all requests, surfacing the failure in chat — useful only for diagnosis, not a real fallback.

## Sign-off

| Scenario | Status | Notes |
|---|---|---|
| 1 — streaming + attachment | | |
| 2 — resume | | |
| 3 — DB-replay fallback | | |
| 4 — policy violation | | |

Operator: _____________  Date: _____________
