import { prisma } from "../../db/client";
import type { PickWorkerArgs, Scheduler, WorkerRecord, WorkerStatus } from "../types";

const ACTIVE_SANDBOX_STATUSES = ["SPAWNING", "RUNNING"] as const;

export function createSimpleScheduler(): Scheduler {
  return {
    async pickWorker(_args: PickWorkerArgs): Promise<WorkerRecord | null> {
      // Pull all READY workers with their active-sandbox counts in one query.
      const workers = await prisma.worker.findMany({
        where: { status: "READY" },
        include: {
          _count: {
            select: {
              sandboxes: {
                where: { status: { in: ACTIVE_SANDBOX_STATUSES as unknown as ("SPAWNING" | "RUNNING")[] } },
              },
            },
          },
        },
      });

      let best: { worker: typeof workers[number]; free: number } | null = null;
      for (const w of workers) {
        const free = w.capacity - w._count.sandboxes;
        if (free <= 0) continue;
        if (!best || free > best.free) best = { worker: w, free };
      }

      if (!best) return null;
      const w = best.worker;
      return {
        id: w.id,
        tailscaleHostname: w.tailscaleHostname,
        tailscaleIp: w.tailscaleIp,
        provider: w.provider,
        providerVmId: w.providerVmId,
        region: w.region,
        capacity: w.capacity,
        status: w.status as WorkerStatus,
      };
    },
  };
}
