import { randomBytes } from "node:crypto";
import { prisma } from "../../db/client";
import { RuntimeError } from "../errors";
import type {
  PickWorkerArgs,
  Runtime,
  SandboxInfo,
  SandboxStatus,
  Scheduler,
  SpawnArgs,
  WorkerProvisioner,
  WorkerRecord,
} from "../types";
import type { AgentClient, SandboxStatusResponse } from "./types";

export interface CreateWorkerPoolRuntimeArgs {
  scheduler: Scheduler;
  provisioner: WorkerProvisioner;
  agentClientFor: (worker: WorkerRecord) => AgentClient;
  sandboxImage: string;
  /** Region to ask the provisioner for if no worker exists. */
  defaultRegion?: string;
  /** Provider-specific size passed to provisioner.provision. */
  defaultSize?: string;
  /** Per-worker capacity passed to provisioner.provision. */
  defaultCapacity?: number;
  /** Provision a new worker when no ready worker has capacity. Defaults to true. */
  autoProvisionWhenFull?: boolean;
  /** Forwarded to sandbox container env (optional). */
  brokerEnv?: () => Record<string, string>;
  /** Hostname clients should use for broker/preview URLs. Defaults to worker.tailscaleIp. */
  publicHostFor?: (worker: WorkerRecord) => string;
  /** Optional public route hook for provider-managed project preview URLs. */
  projectRouteFor?: (args: ProjectRouteArgs) => Promise<{ previewUrl: string }>;
  /** Optional cleanup hook for provider-managed project preview routes. */
  deleteProjectRouteFor?: (args: DeleteProjectRouteArgs) => Promise<void>;
}

export interface ProjectRouteArgs {
  projectId: string;
  sandboxId: string;
  worker: WorkerRecord;
  previewPort: number;
}

export interface DeleteProjectRouteArgs {
  projectId: string;
  sandboxId: string;
}

export function createWorkerPoolRuntime(args: CreateWorkerPoolRuntimeArgs): Runtime {
  return {
    async spawnProjectSandbox(spawn: SpawnArgs): Promise<SandboxInfo> {
      const worker = await ensureWorker(args.scheduler, args.provisioner, {
        defaultRegion: args.defaultRegion ?? "local",
        defaultSize: args.defaultSize ?? "local",
        defaultCapacity: args.defaultCapacity ?? 8,
        autoProvisionWhenFull: args.autoProvisionWhenFull ?? true,
      });
      const agent = args.agentClientFor(worker);
      const sandboxId = randomBytes(16).toString("hex");
      const brokerToken = randomBytes(32).toString("hex");
      let sandboxCreatedOnWorker = false;
      const env: Record<string, string> = {
        PROJECT_ID: spawn.projectId,
        BROKER_TOKEN: brokerToken,
        ...args.brokerEnv?.(),
        ...sourceEnv(spawn.source),
      };
      if (spawn.projectEnvContent) {
        env.PROJECT_ENV_B64 = Buffer.from(spawn.projectEnvContent, "utf8").toString("base64");
      }
      if (spawn.openhandsFiles && spawn.openhandsFiles.length > 0) {
        env.OPENHANDS_FILES_B64 = Buffer.from(JSON.stringify(spawn.openhandsFiles), "utf8").toString("base64");
      }
      // Reserve DB row up-front so a concurrent spawn for the same project hits
      // the unique constraint and we know which one to keep.
      const ws = await prisma.workerSandbox.create({
        data: {
          id: sandboxId,
          workerId: worker.id,
          projectId: spawn.projectId,
          containerId: "pending",
          brokerPort: 0,
          previewPort: 0,
          status: "SPAWNING",
        },
      });
      try {
        const created = await agent.createSandbox({
          sandboxId,
          projectId: spawn.projectId,
          image: args.sandboxImage,
          env,
          brokerToken,
        });
        sandboxCreatedOnWorker = true;
        await prisma.workerSandbox.update({
          where: { id: sandboxId },
          data: {
            containerId: created.containerId,
            brokerPort: created.brokerPort,
            previewPort: created.previewPort,
          },
        });
        await prisma.sandboxToken.create({
          data: {
            sandboxId,
            token: brokerToken,
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
          },
        });
        const publicHost = args.publicHostFor?.(worker) ?? worker.tailscaleIp;
        const routed = await args.projectRouteFor?.({
          projectId: spawn.projectId,
          sandboxId,
          worker,
          previewPort: created.previewPort,
        });
        return {
          sandboxId,
          brokerUrl: `ws://${publicHost}:${created.brokerPort}/?token=${brokerToken}`,
          brokerPreviewToken: brokerToken,
          previewUrl: routed?.previewUrl ?? `http://${publicHost}:${created.previewPort}`,
        };
      } catch (err) {
        if (sandboxCreatedOnWorker) {
          await args.deleteProjectRouteFor?.({
            projectId: spawn.projectId,
            sandboxId,
          }).catch(() => {});
          await agent.destroySandbox(sandboxId).catch(() => {});
        }
        // Rollback: delete token and WorkerSandbox row so retries can proceed cleanly.
        await prisma.sandboxToken.deleteMany({ where: { sandboxId } }).catch(() => {});
        await prisma.workerSandbox.delete({ where: { id: ws.id } }).catch(() => {});
        throw err;
      }
    },

    async destroyProjectSandbox(sandboxId: string): Promise<void> {
      const ws = await prisma.workerSandbox.findUnique({ where: { id: sandboxId } });
      if (!ws) return;
      await args.deleteProjectRouteFor?.({
        projectId: ws.projectId,
        sandboxId,
      }).catch(() => {});
      const worker = await prisma.worker.findUnique({ where: { id: ws.workerId } });
      if (!worker) {
        // Worker is gone (decommissioned). Just clean DB.
        await prisma.sandboxToken.deleteMany({ where: { sandboxId } });
        await prisma.workerSandbox.delete({ where: { id: sandboxId } });
        return;
      }
      const agent = args.agentClientFor(workerRecord(worker));
      await agent.destroySandbox(sandboxId).catch(() => { /* idempotent */ });
      await prisma.sandboxToken.deleteMany({ where: { sandboxId } });
      await prisma.workerSandbox.delete({ where: { id: sandboxId } });
    },

    async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
      const ws = await prisma.workerSandbox.findUnique({ where: { id: sandboxId } });
      if (!ws) return "destroyed";
      const worker = await prisma.worker.findUnique({ where: { id: ws.workerId } });
      if (!worker) return "destroyed";
      const agent = args.agentClientFor(workerRecord(worker));
      const got: SandboxStatusResponse = await agent.getStatus(sandboxId);
      return mapStatus(got.status);
    },
  };
}

function sourceEnv(source: SpawnArgs["source"]): Record<string, string> {
  if (source.type === "template") {
    return { PROJECT_SOURCE_TYPE: "template" };
  }
  return {
    PROJECT_SOURCE_TYPE: "github",
    GITHUB_REPO_OWNER: source.owner,
    GITHUB_REPO_NAME: source.repo,
    GITHUB_REPO_BRANCH: source.branch,
    GITHUB_REPO_TOKEN: source.token,
    GITHUB_REPO_COMMIT_SHA: source.commitSha ?? "",
  };
}

function workerRecord(w: {
  id: string; tailscaleHostname: string; tailscaleIp: string;
  provider: string; providerVmId: string; region: string;
  capacity: number; status: string;
}): WorkerRecord {
  return {
    id: w.id,
    tailscaleHostname: w.tailscaleHostname,
    tailscaleIp: w.tailscaleIp,
    provider: w.provider,
    providerVmId: w.providerVmId,
    region: w.region,
    capacity: w.capacity,
    status: w.status as WorkerRecord["status"],
  };
}

async function ensureWorker(
  scheduler: Scheduler,
  provisioner: WorkerProvisioner,
  defaults: {
    defaultRegion: string;
    defaultSize: string;
    defaultCapacity: number;
    autoProvisionWhenFull: boolean;
  },
): Promise<WorkerRecord> {
  const args: PickWorkerArgs = {};
  const picked = await scheduler.pickWorker(args);
  if (picked) return picked;
  if (!defaults.autoProvisionWhenFull) {
    throw new RuntimeError(
      "NO_WORKER_CAPACITY",
      "No ready worker has a free project slot",
    );
  }
  return await provisioner.provision({
    region: defaults.defaultRegion,
    size: defaults.defaultSize,
    capacity: defaults.defaultCapacity,
  });
}

function mapStatus(s: SandboxStatusResponse["status"]): SandboxStatus {
  switch (s) {
    case "spawning": return "provisioning";
    case "running":  return "running";
    case "stopped":  return "stopped";
    case "gone":     return "destroyed";
  }
}
