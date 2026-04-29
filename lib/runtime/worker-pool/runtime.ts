import { randomBytes } from "node:crypto";
import { prisma } from "../../db/client";
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
  /** Per-worker capacity passed to provisioner.provision. */
  defaultCapacity?: number;
  /** Forwarded to sandbox container env (optional). */
  brokerEnv?: () => Record<string, string>;
  /** Hostname clients should use for broker/preview URLs. Defaults to worker.tailscaleIp. */
  publicHostFor?: (worker: WorkerRecord) => string;
}

export function createWorkerPoolRuntime(args: CreateWorkerPoolRuntimeArgs): Runtime {
  return {
    async spawnProjectSandbox(spawn: SpawnArgs): Promise<SandboxInfo> {
      const worker = await ensureWorker(args.scheduler, args.provisioner, {
        defaultRegion: args.defaultRegion ?? "local",
        defaultCapacity: args.defaultCapacity ?? 8,
      });
      const agent = args.agentClientFor(worker);
      const sandboxId = randomBytes(16).toString("hex");
      const brokerToken = randomBytes(32).toString("hex");
      const env: Record<string, string> = {
        PROJECT_ID: spawn.projectId,
        BROKER_TOKEN: brokerToken,
        ...args.brokerEnv?.(),
      };
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
        return {
          sandboxId,
          brokerUrl: `ws://${publicHost}:${created.brokerPort}/?token=${brokerToken}`,
          brokerPreviewToken: brokerToken,
          previewUrl: `http://${publicHost}:${created.previewPort}`,
        };
      } catch (err) {
        // Rollback: delete the WorkerSandbox row so retries can proceed cleanly.
        await prisma.workerSandbox.delete({ where: { id: ws.id } }).catch(() => {});
        throw err;
      }
    },

    async destroyProjectSandbox(sandboxId: string): Promise<void> {
      const ws = await prisma.workerSandbox.findUnique({ where: { id: sandboxId } });
      if (!ws) return;
      const worker = await prisma.worker.findUnique({ where: { id: ws.workerId } });
      if (!worker) {
        // Worker is gone (decommissioned). Just clean DB.
        await prisma.sandboxToken.deleteMany({ where: { sandboxId } });
        await prisma.workerSandbox.update({ where: { id: sandboxId }, data: { status: "DESTROYED" } });
        return;
      }
      const agent = args.agentClientFor(workerRecord(worker));
      await agent.destroySandbox(sandboxId).catch(() => { /* idempotent */ });
      await prisma.sandboxToken.deleteMany({ where: { sandboxId } });
      await prisma.workerSandbox.update({
        where: { id: sandboxId },
        data: { status: "DESTROYED" },
      });
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
  defaults: { defaultRegion: string; defaultCapacity: number },
): Promise<WorkerRecord> {
  const args: PickWorkerArgs = {};
  const picked = await scheduler.pickWorker(args);
  if (picked) return picked;
  return await provisioner.provision({
    region: defaults.defaultRegion,
    size: "local",
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
