# Managed Hetzner Worker Pool + Public Project Routing Design Spec

**Date:** 2026-05-05
**Status:** Draft for review
**Related task:** T-20260505-014
**Builds on:**
- `docs/superpowers/specs/2026-04-27-phase-h.1-hetzner-runtime-design.md`
- `docs/superpowers/specs/2026-04-28-phase-h.1b-sandbox-image-worker-agent-design.md`
- `docs/superpowers/HANDOVER-2026-04-28-phase-h.1b-to-h.1c.md`

## 1. Goal

Build a managed Hetzner worker pool for Website Builder Daytona.

Admins can create their own Hetzner worker servers from the host UI, define
how many active projects each server may run, and let the runtime place project
sandboxes onto workers with free slots. Project placement is elastic: after a
restart or recreate, a project may move to another ready worker with available
capacity.

Public project access uses a Cloudflare-managed domain with a wildcard Let's
Encrypt certificate and stable per-project subdomains.

## 2. Phase Split

This design intentionally spans the next two H.1 sub-phases because the user
workflow crosses both worker management and public routing.

### H.1c - Managed Hetzner Worker Pool

H.1c delivers the operational worker pool:

- Admin UI for Hetzner workers.
- Live Hetzner server creation through the Hetzner Cloud API.
- Per-worker maximum project capacity.
- Worker bootstrap through cloud-init.
- Worker-agent startup on real Hetzner servers.
- Private host-to-worker communication through Tailscale.
- Slot-based scheduler for new project sandboxes.
- Restart/recreate can move a project to another ready worker.
- Drain and decommission controls.

### H.1d - Public Project Routing

H.1d delivers public domain access:

- Central Caddy instance on the host.
- Cloudflare DNS-01 challenge for wildcard Let's Encrypt.
- One wildcard certificate for `*.BASE_DOMAIN`.
- Stable project subdomains.
- Caddy routes public preview traffic to the currently active worker sandbox.
- Broker/WebSocket routing can move behind the same Caddy layer after preview
  routing is stable.

## 3. Non-Goals

The following remain outside this design:

- Automatic Hetzner server creation during project start. Admins create workers
  explicitly in the Admin UI.
- Per-project Let's Encrypt certificates. A wildcard certificate is simpler,
  faster, and avoids certificate churn.
- Multi-region routing optimization. H.1c may store region, but scheduling is
  least-loaded.
- Auto-pause/resume. This can be layered onto the Caddy route model later.
- Volume persistence for project workspaces.
- gVisor, Firecracker, or other container hardening.
- Billing, quotas per customer, and multi-tenant cost attribution.

## 4. Existing System Fit

The current H.1b runtime already has the right core shape:

- `WorkerPoolRuntime` creates sandboxes through a worker-agent.
- `Worker` stores provider, VM identity, region, capacity, status, Tailscale
  host, and heartbeat data.
- `WorkerSandbox` records the project-to-worker sandbox instance.
- `SimpleScheduler` chooses a worker with capacity.
- `worker-pool-local` validates the same runtime flow locally.

The managed Hetzner design extends this instead of replacing it:

- Keep `WorkerPoolRuntime` provider-agnostic.
- Put Hetzner API behavior behind `WorkerProvisioner`.
- Keep worker-agent HTTP/HMAC contracts unchanged.
- Keep `worker-pool-local` as the fast local validation path.
- Keep Daytona modes unchanged.

## 5. Admin UI

### 5.1 Location

Add a dedicated admin workers surface, preferably:

```text
/admin/workers
```

If the app keeps admin tools on the home page for now, this can be linked from
the existing admin/orphan-sandbox section and later promoted into a full admin
navigation area.

### 5.2 Worker List

The worker list is an operational table, not a decorative dashboard.

Columns:

- Name
- Status
- Slots, for example `6 / 10`
- Hetzner server type
- Region
- Tailscale IP
- Last heartbeat
- Created at
- Actions

Primary statuses:

- `PROVISIONING` - server exists or is being created, not ready for placement.
- `READY` - eligible for new project sandboxes.
- `DRAINING` - existing sandboxes may continue, new sandboxes are not placed.
- `OFFLINE` - heartbeat or agent health failed.
- `DECOMMISSIONED` - no longer part of the active pool.

Actions:

- Create worker.
- Retry provisioning for failed/offline provisioning attempts.
- Drain worker.
- Decommission worker.
- Refresh status.

### 5.3 Create Worker Form

Fields:

- Name.
- Hetzner region, default from `HETZNER_DEFAULT_REGION`.
- Hetzner server type, default from `HETZNER_DEFAULT_SERVER_TYPE`.
- Max projects, default from `WORKER_DEFAULT_CAPACITY`, minimum 1.

The form validates that max projects is a positive safe integer. The backend
validates again before provisioning.

### 5.4 Admin UX Intent

The UI should feel like a compact infrastructure console:

- Dense, scan-friendly rows.
- Quiet borders and neutral surfaces.
- Status color only where it changes operator decisions.
- Slot count is first-class because it answers the main admin question:
  "Where can the next project run?"
- Destructive actions require confirmation.

## 6. Data Model

### 6.1 Worker

Extend the existing `Worker` model.

Existing useful fields:

- `id`
- `tailscaleHostname`
- `tailscaleIp`
- `provider`
- `providerVmId`
- `region`
- `capacity`
- `status`
- `lastHeartbeatAt`
- `createdAt`
- `decommissionedAt`

Add:

- `name String`
- `serverType String?`
- `provisioningError String?`
- `readyAt DateTime?`

`capacity` means maximum active projects/sandboxes on that worker.

### 6.2 WorkerSandbox

Keep `WorkerSandbox` as the active sandbox placement record.

Important behavior:

- A row reserves a project slot on a worker while status is active.
- Active statuses are `SPAWNING`, `RUNNING`, `STOPPED`, and any future paused
  state that still consumes placement capacity.
- Destroyed sandboxes must not consume capacity.

H.1c should replace the current `projectId @unique` with a partial unique
index that only applies to non-destroyed sandboxes. Prisma cannot express this
portably, so the migration should use raw SQL for Postgres.

### 6.3 Project

Rename or migrate:

- `daytonaSandboxId` -> `sandboxId`

Add for H.1d:

- `publicSlug String? @unique`

The project does not need a sticky `assignedWorkerId`. Placement is derived
from the current active `WorkerSandbox`. If the sandbox is destroyed and later
recreated, scheduling can choose a different worker.

### 6.4 Route Data

For H.1d, route state can initially be derived from:

- `Project.publicSlug`
- active `WorkerSandbox.previewPort`
- `Worker.tailscaleIp`

If Caddy route operations need stronger auditability, add a `ProjectRoute`
model later with:

- `projectId`
- `hostname`
- `sandboxId`
- `targetUrl`
- `status`
- `lastAppliedAt`
- `lastError`

The first H.1d pass should prefer derived route state unless implementation
shows a real need for persisted route rows.

## 7. Environment

Required for H.1c:

```text
RUNTIME_MODE=worker-pool-hetzner
SANDBOX_IMAGE=ghcr.io/.../sandbox:<sha>
WORKER_AGENT_IMAGE=ghcr.io/.../worker-agent:<sha>
WORKER_AGENT_HMAC_SECRET=...
HETZNER_API_TOKEN=...
HETZNER_DEFAULT_REGION=fsn1
HETZNER_DEFAULT_SERVER_TYPE=ccx33
WORKER_DEFAULT_CAPACITY=10
TAILSCALE_API_KEY=...
TAILSCALE_TAILNET=...
TAILSCALE_WORKER_TAG=tag:website-builder-worker
```

Required for H.1d:

```text
PUBLIC_BASE_DOMAIN=example.com
CADDY_ADMIN_URL=http://127.0.0.1:2019
CLOUDFLARE_API_TOKEN=...
```

Secrets must never be exposed in client bundles, logs, task files, changelogs,
or UI error payloads.

## 8. Provisioning Flow

### 8.1 Admin Creates Worker

1. Admin submits the create-worker form.
2. API validates name, region, server type, and capacity.
3. Host creates a `Worker` row with `status=PROVISIONING`.
4. `HetznerProvisioner` creates a real Hetzner server.
5. Provisioner generates or requests a Tailscale auth key scoped for worker use.
6. Provisioner sends cloud-init that:
   - installs Docker,
   - joins Tailscale,
   - logs into the container registry if needed,
   - starts the worker-agent container,
   - configures the worker-agent HMAC secret,
   - sets the worker ID and heartbeat URL.
7. Host stores `providerVmId`, expected Tailscale hostname, region, server type,
   and capacity.
8. Host polls or waits for:
   - Tailscale IP resolution, and
   - worker-agent heartbeat.
9. Once heartbeat succeeds, worker moves to `READY` and `readyAt` is set.

### 8.2 Provisioning Failure

If provisioning fails before the server exists:

- Worker row becomes `OFFLINE`.
- `provisioningError` stores a safe, redacted message.

If server exists but bootstrap fails:

- Best-effort destroy the Hetzner server if no sandbox was ever placed.
- Mark worker `OFFLINE` if destroy fails.
- Store a redacted provisioning error.

Provisioning errors should be visible in the Admin UI without leaking tokens.

## 9. Scheduling Flow

### 9.1 New Sandbox Placement

When a project needs a sandbox:

1. Scheduler queries `READY` workers.
2. Scheduler counts active `WorkerSandbox` rows per worker.
3. Candidate workers satisfy `activeCount < capacity`.
4. Scheduler chooses the least-loaded candidate.
5. Runtime creates a `WorkerSandbox` reservation with `SPAWNING`.
6. Runtime calls the chosen worker-agent to create the sandbox container.
7. Runtime updates ports/container ID and token rows.
8. Runtime returns broker and preview URLs.

If no candidate exists, the runtime returns a clear capacity error. Project
creation or project open should surface that admins need to add capacity.

### 9.2 Restart/Recreate Placement

Restart destroys the old sandbox and creates a new one through the scheduler.

The project is not bound to its old worker. A restarted project may move to any
`READY` worker with a free slot.

### 9.3 Draining

When a worker is set to `DRAINING`:

- Scheduler excludes it from new placements.
- Existing sandboxes continue running.
- Admin can destroy/restart projects to move them elsewhere.
- Decommission is blocked while active sandboxes remain, unless an explicit
  force action is added later.

## 10. Public Routing Flow

H.1d introduces Caddy and Cloudflare-backed wildcard TLS.

### 10.1 Certificate Model

Use one wildcard certificate:

```text
*.PUBLIC_BASE_DOMAIN
```

The certificate is issued through Let's Encrypt DNS-01 using Cloudflare. This
avoids per-project certificate issuance and lets project creation avoid any
Let's Encrypt round trip.

### 10.2 Project Subdomains

Each project receives a stable slug:

```text
<project-public-slug>.PUBLIC_BASE_DOMAIN
```

The slug should be generated from the project name and made unique. It should
remain stable unless the user explicitly changes it later.

### 10.3 Caddy Route Application

When a sandbox is running:

1. Host derives the route target from active sandbox placement:
   `http://worker.tailscaleIp:previewPort`.
2. Host applies or reloads the Caddy route for the project hostname.
3. Browser preview URL becomes `https://project-slug.PUBLIC_BASE_DOMAIN`.

When a sandbox is destroyed:

- Host removes or disables the route.
- If the project restarts on another worker, route target updates to the new
  worker and port.

### 10.4 Broker/WebSocket Routing

Preview routing is the first H.1d target. Broker/WebSocket routing can follow
the same Caddy path once preview is stable.

Until then, H.1c can continue using private Tailscale worker-agent access and
existing broker URL behavior for host-side ws-proxy connections.

## 11. API Surface

H.1c admin APIs:

```text
GET    /api/admin/workers
POST   /api/admin/workers
POST   /api/admin/workers/[id]/drain
POST   /api/admin/workers/[id]/retry
DELETE /api/admin/workers/[id]
```

H.1d routing APIs can stay internal:

```text
POST /api/internal/routes/apply
```

If Caddy route application is called only from server-side runtime code, no
public route endpoint is required.

## 12. Error Handling

Capacity errors:

- Return a typed runtime error such as `NO_WORKER_CAPACITY`.
- UI explains that no ready worker has a free project slot.

Provisioning errors:

- Redact provider and auth tokens.
- Persist a short admin-visible failure reason.
- Keep full sensitive detail out of logs unless logs are already protected.

Heartbeat loss:

- Worker becomes `OFFLINE` after a grace window.
- Scheduler excludes offline workers.
- Existing project status should show that the sandbox worker is unreachable.

Caddy route failure:

- Project sandbox can still exist.
- Public URL shows unavailable until route apply succeeds.
- Admin UI should expose the last route error once H.1d adds route state.

## 13. Testing Strategy

H.1c unit tests:

- Hetzner client request construction with mocked fetch.
- Tailscale client auth-key and device lookup with mocked fetch.
- cloud-init rendering without secret leakage in snapshots.
- scheduler only chooses `READY` workers with free slots.
- scheduler excludes `DRAINING`, `OFFLINE`, and full workers.
- restart destroys old sandbox and can place the new sandbox on another worker.

H.1c route tests:

- Admin worker list returns slot counts.
- Create-worker route validates capacity.
- Drain route excludes worker from scheduling.
- Decommission refuses active workers.

H.1c integration/manual validation:

- Admin creates one real Hetzner worker with capacity `10`.
- Worker reaches `READY`.
- Creating/opening projects fills slots on that worker.
- A second worker receives new projects once the first is full.
- Restart can move a project to another worker if slots are available.

H.1d tests:

- Project slug generation is stable and unique.
- Caddy config builder maps hostnames to worker preview targets.
- Route update changes target when sandbox moves workers.
- Certificate/domain env validation fails closed.

H.1d manual validation:

- Wildcard certificate is issued for the Cloudflare domain.
- `https://project-slug.PUBLIC_BASE_DOMAIN` loads the project preview.
- Restart on another worker updates the route without changing the URL.

## 14. Rollout

1. Keep default runtime unchanged.
2. Implement H.1c behind `RUNTIME_MODE=worker-pool-hetzner`.
3. Validate `worker-pool-local` still passes.
4. Create a single Hetzner worker from Admin UI.
5. Validate one real project sandbox on that worker.
6. Add a second worker and validate slot scheduling.
7. Enable public routing only after worker scheduling is stable.

## 15. Open Operational Decisions

These are explicit implementation-time choices, not unknown requirements:

- First live region default is `fsn1`.
- First default server type is env-controlled and should start with the
  smallest type that can reliably run the chosen max project count.
- Capacity is an admin-entered project slot count, not automatically derived
  from CPU/RAM.
- Worker creation is admin-triggered, not automatic during project open.
- Project placement is elastic and may change on restart/recreate.
