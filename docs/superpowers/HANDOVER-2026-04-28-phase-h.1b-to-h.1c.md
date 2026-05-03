# Handover — Phase H.1b complete → H.1c next

**Date:** 2026-04-28  
**Repo:** `/Volumes/Extern/Projekte/website-builder-daytona`  
**Current branch:** `main`  
**Remote state:** `main` pushed to `origin/main` at `5954f63`  
**Phase just completed:** H.1b — Pre-built Sandbox-Image + Worker-Agent + LocalDocker-Runtime  

## Current State

Phase H.1b is implemented, merged to `main`, tagged, and pushed.

The local feature branch `feat/phase-h.1b-sandbox-image-worker-agent` was deleted after the merge. The phase tag `phase-h.1b-sandbox-image-worker-agent` exists locally and on `origin`, pointing at `bc158c9`.

Relevant docs:
- `docs/superpowers/specs/2026-04-28-phase-h.1b-sandbox-image-worker-agent-design.md`
- `docs/superpowers/plans/2026-04-28-phase-h.1b-sandbox-image-worker-agent.md`
- Parent H.1 spec: `docs/superpowers/specs/2026-04-27-phase-h.1-hetzner-runtime-design.md`

## What Shipped

- `container/sandbox/` now contains the pre-built sandbox image source:
  - `Dockerfile`
  - simplified `entrypoint.sh`
  - moved `broker/`
  - moved `project-template/`
- New `worker-agent/` workspace package:
  - Fastify HTTP server
  - HMAC middleware
  - Docker sandbox lifecycle wrapper
  - heartbeat loop
  - local Docker image startup path
- New host worker-pool runtime:
  - `lib/runtime/worker-pool/agent-client.ts`
  - `lib/runtime/worker-pool/runtime.ts`
  - `lib/runtime/worker-pool/index.ts`
  - `RUNTIME_MODE=worker-pool-local`
- New heartbeat receiver:
  - `app/api/internal/workers/[id]/heartbeat/route.ts`
- Local-dev scripts:
  - `scripts/build-sandbox-image.sh`
  - `scripts/start-local-worker-agent.sh`
  - `scripts/register-local-worker.ts`
- CI workflows:
  - `.github/workflows/sandbox-image.yml`
  - `.github/workflows/worker-agent.yml`

## Live E2E Findings Fixed

- Worker-pool project creation no longer requires Daytona GitHub clone env vars.
- The first Claude turn no longer pre-creates `SessionRuntimeState`; this prevents `--resume` from being used against a fresh container session.
- Local sandbox broker receives agent credentials through `brokerEnv`.
- Worker-agent skips pulling a locally built sandbox image when it already exists.
- Sandbox entrypoint initializes a git repo so the Claude reviewer sub-agent can inspect working-tree changes.
- Sandbox project-template allows local preview origins so `127.0.0.1:<port>` iframe/HMR works.
- Build-time strict type issues were fixed in `agent-client.ts` and `worker-agent/src/server.ts`.
- Root `next.config.ts` pins Turbopack root to avoid walking up to a parent lockfile.

## Verification Evidence

Final verification on `main`:

- `pnpm lint`: passed with 0 errors and 3 warnings.
- `pnpm build`: passed with one Turbopack NFT warning.
- `pnpm test`: passed after retrying one transient Docker port allocation race.
  - worker-agent: 30/30
  - ws-proxy: 8/8
  - broker: 67/67
- Browser live E2E was manually confirmed by the user:
  - new project creation/open works
  - chat send works
  - preview iframe updates

## Known Follow-Ups

- Docker integration test has a transient host-port race:
  - symptom: Docker reports `Bind for 0.0.0.0:<port> failed: port is already allocated`
  - immediate workaround: rerun `pnpm test`
  - likely future fix: make Docker wrapper retry container creation when Docker rejects a port that was free during preflight.
- `pnpm lint` warnings remain:
  - `lib/runtime/scheduler/simple.ts` unused `_args`
  - `worker-agent/tests/docker.test.ts` unused `r`
  - `ws-proxy/broker-direct-test.mjs` unused `projectId`
- `pnpm build` reports a Turbopack NFT warning from an import trace through `next.config.ts` → broker fs code. Build still exits 0.

## Suggested Next Session Start

1. Confirm repo state:
   ```bash
   git status --short --branch
   git log --oneline --decorate -5
   ```

2. Read these docs:
   ```bash
   sed -n '1,140p' docs/superpowers/specs/2026-04-27-phase-h.1-hetzner-runtime-design.md
   sed -n '1,120p' docs/superpowers/specs/2026-04-28-phase-h.1b-sandbox-image-worker-agent-design.md
   sed -n '1,180p' docs/superpowers/HANDOVER-2026-04-28-phase-h.1b-to-h.1c.md
   ```

3. Start Phase H.1c planning:
   - `HetznerProvisioner`
   - Tailscale auth-key generation / worker identity
   - cloud-init for worker VM bootstrap
   - worker-agent deployment on real VM
   - scheduler path using real Tailscale IPs instead of `127.0.0.1`
   - decommission/offline worker handling

## H.1c Guardrails

- Keep `WorkerPoolRuntime` provider-agnostic.
- Put Hetzner-specific logic behind `WorkerProvisioner`.
- Do not add Caddy/wildcard TLS in H.1c unless the H.1c plan explicitly expands scope; that belongs to H.1d.
- Keep Daytona modes working unchanged.
- Preserve existing local mode: `RUNTIME_MODE=worker-pool-local` should remain the fast dev validation path.
