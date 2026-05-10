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
      const defaults = {
        defaultRegion: args.defaultRegion ?? "local",
        defaultSize: args.defaultSize ?? "local",
        defaultCapacity: args.defaultCapacity ?? 8,
        autoProvisionWhenFull: args.autoProvisionWhenFull ?? true,
      };
      const reservation = await reserveSandboxSlot(args, defaults, spawn.projectId);
      const { worker, sandboxId, brokerToken, agentRunnerHmacSecret, ws } = reservation;
      const agent = args.agentClientFor(worker);
      let sandboxCreatedOnWorker = false;
      const ownerProject = await prisma.project.findUnique({
        where: { id: spawn.projectId },
        select: { owner: { select: { name: true, email: true } } },
      });
      const ownerName = (ownerProject?.owner.name ?? "").trim();
      const ownerEmail = (ownerProject?.owner.email ?? "").trim();
      const perTurnCapUsd = (process.env.DEFAULT_PER_TURN_USD_CAP ?? "").trim();
      const env: Record<string, string> = {
        PROJECT_ID: spawn.projectId,
        BROKER_TOKEN: brokerToken,
        // Per-sandbox shared secret used by the broker to sign HTTP calls to
        // the in-container agent-runner sibling and by the agent-runner to
        // verify them. Generated fresh per sandbox alongside BROKER_TOKEN.
        AGENT_RUNNER_HMAC_SECRET: agentRunnerHmacSecret,
        // Owner identity forwarded to the broker so it can attribute USER
        // commits made via the worker-agent's git surface. Empty values are
        // omitted; the broker treats missing values as "no USER identity".
        ...(ownerName ? { BROKER_USER_NAME: ownerName } : {}),
        ...(ownerEmail ? { BROKER_USER_EMAIL: ownerEmail } : {}),
        // Phase 1.4e: per-turn USD cap enforced by the broker's
        // agent.usage observer. Empty/unset disables the cap.
        ...(perTurnCapUsd ? { BROKER_PER_TURN_USD_CAP: perTurnCapUsd } : {}),
        ...args.brokerEnv?.(),
        ...sourceEnv(spawn.source),
      };
      if (spawn.projectEnvContent) {
        env.PROJECT_ENV_B64 = Buffer.from(spawn.projectEnvContent, "utf8").toString("base64");
      }
      if (spawn.openhandsFiles && spawn.openhandsFiles.length > 0) {
        env.OPENHANDS_FILES_B64 = Buffer.from(JSON.stringify(spawn.openhandsFiles), "utf8").toString("base64");
      }
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

async function reserveSandboxSlot(
  args: CreateWorkerPoolRuntimeArgs,
  defaults: {
    defaultRegion: string;
    defaultSize: string;
    defaultCapacity: number;
    autoProvisionWhenFull: boolean;
  },
  projectId: string,
): Promise<{
  worker: WorkerRecord;
  sandboxId: string;
  brokerToken: string;
  agentRunnerHmacSecret: string;
  ws: { id: string };
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const worker = await ensureWorker(args.scheduler, args.provisioner, defaults);
    const sandboxId = randomBytes(16).toString("hex");
    const brokerToken = randomBytes(32).toString("hex");
    const agentRunnerHmacSecret = randomBytes(32).toString("hex");
    const ws = await reserveWorkerSandbox(worker, sandboxId, projectId);
    if (ws) {
      return { worker, sandboxId, brokerToken, agentRunnerHmacSecret, ws };
    }
  }

  throw new RuntimeError(
    "NO_WORKER_CAPACITY",
    "No ready worker has a free project slot",
  );
}

async function reserveWorkerSandbox(
  worker: WorkerRecord,
  sandboxId: string,
  projectId: string,
): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    const lockedWorkers = await tx.$queryRaw<Array<{ id: string; capacity: number; status: string }>>`
      SELECT id, capacity, status
      FROM "Worker"
      WHERE id = ${worker.id}
      FOR UPDATE
    `;
    const [lockedWorker] = lockedWorkers;
    if (!lockedWorker || lockedWorker.status !== "READY") return null;

    const usedSlots = await tx.workerSandbox.count({
      where: {
        workerId: worker.id,
        status: { in: ["SPAWNING", "RUNNING", "STOPPED"] },
      },
    });
    if (usedSlots >= lockedWorker.capacity) return null;

    return tx.workerSandbox.create({
      data: {
        id: sandboxId,
        workerId: worker.id,
        projectId,
        containerId: "pending",
        brokerPort: 0,
        previewPort: 0,
        status: "SPAWNING",
      },
      select: { id: true },
    });
  });
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
