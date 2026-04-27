import { randomBytes } from "node:crypto";
import { prisma } from "../../db/client";
import type { ProvisionArgs, WorkerProvisioner, WorkerRecord, WorkerStatus } from "../types";

const PROVIDER_ID = "fake";

function rowToRecord(row: {
  id: string;
  tailscaleHostname: string;
  tailscaleIp: string;
  provider: string;
  providerVmId: string;
  region: string;
  capacity: number;
  status: WorkerStatus;
}): WorkerRecord {
  return {
    id: row.id,
    tailscaleHostname: row.tailscaleHostname,
    tailscaleIp: row.tailscaleIp,
    provider: row.provider,
    providerVmId: row.providerVmId,
    region: row.region,
    capacity: row.capacity,
    status: row.status,
  };
}

export function createFakeProvisioner(): WorkerProvisioner {
  return {
    providerId: PROVIDER_ID,

    async provision({ region, size, capacity }: ProvisionArgs): Promise<WorkerRecord> {
      const suffix = randomBytes(4).toString("hex");
      const row = await prisma.worker.create({
        data: {
          tailscaleHostname: `fake-worker-${suffix}`,
          tailscaleIp: `100.64.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
          provider: PROVIDER_ID,
          providerVmId: `fake-${size}-${suffix}`,
          region,
          capacity,
          status: "READY",
        },
      });
      return rowToRecord(row);
    },

    async destroy(workerId: string): Promise<void> {
      const existing = await prisma.worker.findUnique({ where: { id: workerId } });
      if (!existing || existing.provider !== PROVIDER_ID) return;
      await prisma.worker.update({
        where: { id: workerId },
        data: { status: "DECOMMISSIONED", decommissionedAt: new Date() },
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
