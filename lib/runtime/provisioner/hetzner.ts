import { randomBytes } from "node:crypto";
import { prisma } from "../../db/client";
import type { ProvisionArgs, WorkerProvisioner, WorkerRecord, WorkerStatus } from "../types";
import { renderWorkerCloudInit } from "./cloud-init";
import { createHetznerClient, type HetznerClient } from "./hetzner-client";
import {
  createTailscaleClient,
  type TailscaleAuthKey,
  type TailscaleClient,
} from "./tailscale-client";

const PROVIDER_ID = "hetzner";
const PENDING_PROVIDER_VM_ID = "pending";
const DEFAULT_HETZNER_IMAGE = "ubuntu-24.04";
const DEFAULT_TAILSCALE_TAG = "tag:wbd-worker";
const DEFAULT_TAILSCALE_AUTH_KEY_EXPIRY_SECONDS = 3600;
const DEFAULT_TAILSCALE_LOOKUP_ATTEMPTS = 90;
const DEFAULT_TAILSCALE_LOOKUP_INTERVAL_MS = 5_000;

export interface CreateHetznerProvisionerArgs {
  hetzner: HetznerClient;
  tailscale: TailscaleClient;
  workerAgentImage: string;
  workerAgentHmacSecret: string;
  appBaseUrl: string;
  sandboxImage: string;
  imageRegistryAuth?: {
    registry: string;
    username: string;
    token: string;
  };
  hetznerImage?: string;
  tailscaleTags?: string[];
  tailscaleAuthKeyExpirySeconds?: number;
  tailscaleLookupAttempts?: number;
  tailscaleLookupIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

interface WorkerRow {
  id: string;
  name: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;
  providerVmId: string;
  region: string;
  capacity: number;
  status: WorkerStatus;
  serverType: string | null;
  provisioningError: string | null;
  readyAt: Date | null;
}

interface CreatedServer {
  id: string;
  name: string;
  publicIpv4: string | null;
}

function rowToRecord(row: WorkerRow): WorkerRecord {
  return {
    id: row.id,
    name: row.name,
    tailscaleHostname: row.tailscaleHostname,
    tailscaleIp: row.tailscaleIp,
    provider: row.provider,
    providerVmId: row.providerVmId,
    region: row.region,
    capacity: row.capacity,
    status: row.status,
    serverType: row.serverType,
    provisioningError: row.provisioningError,
    readyAt: row.readyAt,
  };
}

export function createHetznerProvisioner(args: CreateHetznerProvisionerArgs): WorkerProvisioner {
  const hetznerImage = args.hetznerImage ?? DEFAULT_HETZNER_IMAGE;
  const tailscaleTags = args.tailscaleTags ?? [DEFAULT_TAILSCALE_TAG];
  const tailscaleAuthKeyExpirySeconds =
    args.tailscaleAuthKeyExpirySeconds ?? DEFAULT_TAILSCALE_AUTH_KEY_EXPIRY_SECONDS;
  const tailscaleLookupAttempts =
    args.tailscaleLookupAttempts ?? DEFAULT_TAILSCALE_LOOKUP_ATTEMPTS;
  const tailscaleLookupIntervalMs =
    args.tailscaleLookupIntervalMs ?? DEFAULT_TAILSCALE_LOOKUP_INTERVAL_MS;
  const now = args.now ?? (() => new Date());
  const sleep = args.sleep ?? defaultSleep;

  return {
    providerId: PROVIDER_ID,

    async provision(input: ProvisionArgs): Promise<WorkerRecord> {
      const workerName = input.name ?? createWorkerName(now);
      let row: WorkerRow | null = null;
      let server: CreatedServer | null = null;
      let authKey: TailscaleAuthKey | null = null;

      try {
        row = await prisma.worker.create({
          data: {
            name: workerName,
            tailscaleHostname: workerName,
            tailscaleIp: "",
            provider: PROVIDER_ID,
            providerVmId: PENDING_PROVIDER_VM_ID,
            region: input.region,
            capacity: input.capacity,
            status: "PROVISIONING",
            serverType: input.size,
          },
        });
        authKey = await args.tailscale.createAuthKey({
          description: `Website Builder Daytona worker ${row.id} ${row.name}`,
          tags: tailscaleTags,
          reusable: false,
          expirySeconds: tailscaleAuthKeyExpirySeconds,
        });
        const userData = renderWorkerCloudInit({
          workerId: row.id,
          workerAgentImage: args.workerAgentImage,
          workerAgentHmacSecret: args.workerAgentHmacSecret,
          tailscaleAuthKey: authKey.key,
          appBaseUrl: stripTrailingSlash(args.appBaseUrl),
          sandboxImage: args.sandboxImage,
          imageRegistryAuth: args.imageRegistryAuth,
        });
        server = await args.hetzner.createServer({
          name: row.name,
          serverType: input.size,
          image: hetznerImage,
          location: input.region,
          userData,
          labels: {
            app: "website-builder-daytona",
            provider: PROVIDER_ID,
            workerId: row.id,
          },
        });
        const tailscaleHostname = server.name;
        await prisma.worker.update({
          where: { id: row.id },
          data: { providerVmId: server.id, tailscaleHostname },
        });
        const tailscaleIp = await waitForTailscaleIp({
          tailscale: args.tailscale,
          hostname: tailscaleHostname,
          attempts: tailscaleLookupAttempts,
          intervalMs: tailscaleLookupIntervalMs,
          sleep,
        });
        const updated = await prisma.worker.update({
          where: { id: row.id },
          data: {
            tailscaleIp,
            provisioningError: null,
          },
        });

        return rowToRecord(updated);
      } catch (error) {
        if (server) {
          await deleteServerIgnoringErrors(args.hetzner, server.id);
        }
        if (authKey?.id) {
          await deleteAuthKeyIgnoringErrors(args.tailscale, authKey.id);
        }
        if (row) {
          await recordProvisioningErrorIgnoringErrors(row.id, errorMessage(error));
        }
        throw error;
      }
    },

    async destroy(workerId: string): Promise<void> {
      const worker = await prisma.worker.findUnique({ where: { id: workerId } });

      if (!worker || worker.provider !== PROVIDER_ID) {
        return;
      }

      if (worker.providerVmId !== PENDING_PROVIDER_VM_ID) {
        await args.hetzner.deleteServer(worker.providerVmId);
      }

      await prisma.worker.updateMany({
        where: { id: workerId, provider: PROVIDER_ID },
        data: {
          status: "DECOMMISSIONED",
          decommissionedAt: now(),
          tailscaleHostname: decommissionedHostname(worker.tailscaleHostname, worker.id),
        },
      });
    },

    async listOwned(): Promise<WorkerRecord[]> {
      const rows = await prisma.worker.findMany({
        where: {
          provider: PROVIDER_ID,
          status: { not: "DECOMMISSIONED" },
        },
      });

      return rows.map(rowToRecord);
    },
  };
}

function decommissionedHostname(hostname: string, workerId: string): string {
  if (hostname.includes("-decommissioned-")) return hostname;
  return `${hostname}-decommissioned-${workerId.slice(0, 8)}`;
}

export function createHetznerWorkerProvisionerFromEnv(
  runtimeEnv: Record<string, string | undefined> = process.env,
): WorkerProvisioner {
  return createHetznerProvisioner({
    hetzner: createHetznerClient(requiredEnv("HETZNER_API_TOKEN", runtimeEnv)),
    tailscale: createTailscaleClient({
      apiKey: requiredEnv("TAILSCALE_API_KEY", runtimeEnv),
      tailnet: requiredEnv("TAILSCALE_TAILNET", runtimeEnv),
    }),
    workerAgentImage: requiredEnv("WORKER_AGENT_IMAGE", runtimeEnv),
    workerAgentHmacSecret: requiredEnv("WORKER_AGENT_HMAC_SECRET", runtimeEnv),
    appBaseUrl: requiredEnv("APP_BASE_URL", runtimeEnv),
    sandboxImage: requiredEnv("SANDBOX_IMAGE", runtimeEnv),
    imageRegistryAuth: imageRegistryAuthFromEnv(runtimeEnv),
    hetznerImage: runtimeEnv.HETZNER_IMAGE ?? DEFAULT_HETZNER_IMAGE,
    tailscaleTags: [runtimeEnv.TAILSCALE_WORKER_TAG ?? DEFAULT_TAILSCALE_TAG],
    tailscaleAuthKeyExpirySeconds: parsePositiveInteger(
      runtimeEnv.TAILSCALE_AUTH_KEY_EXPIRY_SECONDS,
      DEFAULT_TAILSCALE_AUTH_KEY_EXPIRY_SECONDS,
    ),
    tailscaleLookupAttempts: parsePositiveInteger(
      runtimeEnv.TAILSCALE_LOOKUP_ATTEMPTS,
      DEFAULT_TAILSCALE_LOOKUP_ATTEMPTS,
    ),
    tailscaleLookupIntervalMs: parsePositiveInteger(
      runtimeEnv.TAILSCALE_LOOKUP_INTERVAL_MS,
      DEFAULT_TAILSCALE_LOOKUP_INTERVAL_MS,
    ),
  });
}

export function requiredEnv(name: string, runtimeEnv: Record<string, string | undefined>): string {
  const value = runtimeEnv[name];

  if (!value) {
    throw new Error(`Hetzner provisioner requires env ${name}`);
  }

  return value;
}

function imageRegistryAuthFromEnv(
  runtimeEnv: Record<string, string | undefined>,
): CreateHetznerProvisionerArgs["imageRegistryAuth"] {
  const username = runtimeEnv.IMAGE_REGISTRY_USERNAME;
  const token = runtimeEnv.IMAGE_REGISTRY_TOKEN;
  if (!username || !token) return undefined;
  const registry = runtimeEnv.IMAGE_REGISTRY_HOST ?? "ghcr.io";
  return { registry, username, token };
}

function createWorkerName(now: () => Date): string {
  const timestamp = now().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `wbd-worker-${timestamp}-${randomBytes(3).toString("hex")}`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function waitForTailscaleIp(args: {
  tailscale: TailscaleClient;
  hostname: string;
  attempts: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<string> {
  const attempts = Math.max(1, args.attempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ip = await args.tailscale.findDeviceIpByHostname(args.hostname);
    if (ip) return ip;
    if (attempt < attempts) {
      await args.sleep(args.intervalMs);
    }
  }

  throw new Error(`Tailscale device did not become ready for ${args.hostname}`);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("TAILSCALE_AUTH_KEY_EXPIRY_SECONDS must be a positive integer");
  }

  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deleteServerIgnoringErrors(hetzner: HetznerClient, serverId: string): Promise<void> {
  try {
    await hetzner.deleteServer(serverId);
  } catch {
    // Preserve the original provisioning error. Reconciliation can retry cleanup.
  }
}

async function deleteAuthKeyIgnoringErrors(
  tailscale: TailscaleClient,
  keyId: string,
): Promise<void> {
  try {
    await tailscale.deleteAuthKey(keyId);
  } catch {
    // Preserve the original provisioning error. The one-use key still expires.
  }
}

async function recordProvisioningErrorIgnoringErrors(
  workerId: string,
  provisioningError: string,
): Promise<void> {
  try {
    await prisma.worker.updateMany({
      where: { id: workerId },
      data: { provisioningError },
    });
  } catch {
    // Preserve the original provisioning error. The DB may be the failing dependency.
  }
}
