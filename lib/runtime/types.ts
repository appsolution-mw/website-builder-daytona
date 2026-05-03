/**
 * Public contract for a sandbox runtime — the layer that turns a "spawn this
 * project's container" request into a running container reachable via WSS.
 *
 * Implementations:
 *   - DaytonaCloudRuntime  — uses Daytona Cloud API (existing, kept for backward compat)
 *   - DaytonaFakeRuntime   — in-process broker for local dev (existing)
 *   - HetznerRuntime       — multi-cloud Docker runtime (built progressively in H.1b–d)
 */
export interface Runtime {
  spawnProjectSandbox(args: SpawnArgs): Promise<SandboxInfo>;
  destroyProjectSandbox(sandboxId: string): Promise<void>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
}

export interface SpawnArgs {
  projectId: string;
  cloneToken: string;
  repoOwner: string;
  repoName: string;
  projectEnvContent?: string;
}

export interface SandboxInfo {
  sandboxId: string;
  /** WSS URL the ws-proxy connects to. */
  brokerUrl: string;
  /** Token the ws-proxy must send (may be empty). */
  brokerPreviewToken: string;
  /** HTTPS URL the browser loads in an iframe. */
  previewUrl: string;
}

/**
 * Runtime-facing sandbox status returned by Runtime.getSandboxStatus().
 * Intentionally distinct from the DB-level `SandboxLifecycleStatus` Prisma
 * enum (which tracks container lifecycle states). Mapping between the two
 * lives in HetznerRuntime.
 */
export type SandboxStatus =
  | "provisioning"
  | "running"
  | "stopped"
  | "destroyed"
  | "error";

/* -------------------------------------------------------------------------- */
/* Worker pool primitives — used by HetznerRuntime, not by Daytona runtimes.  */
/* -------------------------------------------------------------------------- */

/**
 * A worker is a single VM that can host multiple sandbox containers. Owned by
 * a cloud provider, joined to our Tailnet via auth-key during provisioning.
 */
export interface WorkerRecord {
  id: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;       // 'hetzner' | 'vultr' | 'linode' | 'fake' | …
  providerVmId: string;
  region: string;         // provider-specific region code
  capacity: number;       // max concurrent sandboxes
  status: WorkerStatus;
}

export type WorkerStatus =
  | "PROVISIONING"
  | "READY"
  | "DRAINING"
  | "DECOMMISSIONED"
  | "OFFLINE";

/**
 * Provisions/destroys a worker VM at one cloud provider.
 *
 * Implementations:
 *   - FakeProvisioner       — in-memory + DB record, no real VM (this phase)
 *   - HetznerProvisioner    — Hetzner Cloud API (H.1c)
 *   - {Vultr,Linode,…}Provisioner — later
 */
export interface WorkerProvisioner {
  /** Provider identifier, e.g. 'hetzner', 'fake'. */
  readonly providerId: string;

  provision(args: ProvisionArgs): Promise<WorkerRecord>;
  destroy(workerId: string): Promise<void>;
  /** List workers we own (for reconciliation against DB). */
  listOwned(): Promise<WorkerRecord[]>;
}

export interface ProvisionArgs {
  region: string;
  size: string;            // provider-specific size code, e.g. 'ccx33'
  capacity: number;        // how many sandboxes this worker should be sized for
}

/**
 * Decides which worker hosts a new sandbox. Pure logic + DB queries; no HTTP.
 *
 * Returns null if no worker has capacity — caller (HetznerRuntime) will then
 * decide whether to provision a new one.
 */
export interface Scheduler {
  pickWorker(args: PickWorkerArgs): Promise<WorkerRecord | null>;
}

export interface PickWorkerArgs {
  /** Hint for region-aware scheduling later; ignored by SimpleScheduler. */
  preferredRegion?: string;
  /** Hint for provider preference later; ignored by SimpleScheduler. */
  preferredProvider?: string;
}
