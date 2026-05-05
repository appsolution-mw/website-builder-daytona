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
      const ipB = (parseInt(suffix.slice(0, 2), 16) % 253) + 1;
      const ipC = (parseInt(suffix.slice(2, 4), 16) % 253) + 1;
      const row = await prisma.worker.create({
        data: {
          name: `Fake worker ${suffix}`,
          tailscaleHostname: `fake-worker-${suffix}`,
          tailscaleIp: `100.64.${ipB}.${ipC}`,
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
      // updateMany returns { count: 0 } for non-existent / non-fake workers,
      // making destroy() naturally idempotent in a single round-trip.
      await prisma.worker.updateMany({
        where: { id: workerId, provider: PROVIDER_ID },
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
