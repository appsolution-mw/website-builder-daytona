# Hetzner Worker Pool Live Validation

Use this checklist before enabling `RUNTIME_MODE=worker-pool-hetzner` for real
users. Do not paste API tokens, HMAC secrets, or Cloudflare credentials into
logs, screenshots, or task files.

## Required Host Environment

```env
RUNTIME_MODE=worker-pool-hetzner
SANDBOX_IMAGE=ghcr.io/<org>/<sandbox-image>:<tag>
WORKER_AGENT_IMAGE=ghcr.io/<org>/<worker-agent-image>:<tag>
WORKER_AGENT_HMAC_SECRET=<32-byte-random-secret>
APP_BASE_URL=https://<host-app-domain>

HETZNER_API_TOKEN=<hetzner-cloud-api-token>
HETZNER_DEFAULT_REGION=fsn1
HETZNER_DEFAULT_SERVER_TYPE=ccx33
WORKER_DEFAULT_CAPACITY=10

TAILSCALE_API_KEY=<tailscale-api-key>
TAILSCALE_TAILNET=<tailnet-name>
```

Optional public preview routing:

```env
PUBLIC_BASE_DOMAIN=example.com
CADDY_ADMIN_URL=http://127.0.0.1:2019
```

Cloudflare credentials for wildcard DNS-01 should live in the Caddy deployment,
not in the Next.js app, unless a later feature explicitly needs them in the
host.

## Preflight

- Database migrations have been applied to the target database.
- The host can reach the Tailscale API and Hetzner Cloud API.
- The host is joined to the same Tailnet that new workers join.
- `SANDBOX_IMAGE` and `WORKER_AGENT_IMAGE` are published and pullable by Hetzner
  workers.
- `WORKER_AGENT_HMAC_SECRET` is identical on the host and worker-agent.
- If public routing is enabled, Caddy is running, its admin API is reachable
  from the host only, and `*.PUBLIC_BASE_DOMAIN` has a valid wildcard
  certificate.

## Live Flow

1. Start the host with `RUNTIME_MODE=worker-pool-hetzner`.
2. Open `/admin/workers`.
3. Create one Hetzner worker with capacity `10`, the intended region, and the
   intended server type.
4. Confirm the worker appears as provisioning, then ready, with `0 / 10` slots
   used.
5. Confirm Hetzner Cloud shows the VM and Tailscale shows a matching Tailnet
   machine with a `100.x` address.
6. Create a new project.
7. Confirm the project becomes running and the worker shows `1 / 10` slots used.
8. If public routing is enabled, confirm the preview URL is
   `https://<project-public-slug>.PUBLIC_BASE_DOMAIN` and loads the sandbox.
   Without public routing, confirm the preview URL falls back to the worker
   Tailnet host and preview port.
9. Create projects until the first worker reaches `10 / 10` used slots.
10. Create one more project and confirm the API/UI surfaces a capacity error
    instead of silently creating a pending project.
11. Add a second worker from `/admin/workers`.
12. Create or restart a project and confirm placement uses the worker with a
    free slot.
13. Restart an existing project after both workers have free capacity. Confirm
    the old sandbox is destroyed, a new sandbox is assigned to a ready worker,
    and the public route now points at the new worker preview port.
14. Drain a worker. Confirm new projects avoid it while existing sandboxes stay
    reachable.
15. After the drained worker has no active sandboxes, decommission/delete it and
    confirm the Hetzner VM is removed.

## Cleanup Checks

- No unexpected Hetzner servers remain.
- No stale provisioning workers remain in `/admin/workers`.
- No active `WorkerSandbox` rows point at deleted workers.
- Public Caddy routes for deleted projects are gone or return `404` from the
  admin API.
- Tailscale machines for removed workers are cleaned up according to the
  Tailnet retention policy.
