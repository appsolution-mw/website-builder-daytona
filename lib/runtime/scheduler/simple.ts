import { prisma } from "../../db/client";
import type { Scheduler, WorkerRecord, WorkerStatus } from "../types";

const SLOT_CONSUMING_SANDBOX_STATUSES = ["SPAWNING", "RUNNING", "STOPPED"] as const;

export function createSimpleScheduler(): Scheduler {
  return {
    async pickWorker(): Promise<WorkerRecord | null> {
      // Pull all READY workers with their slot-consuming sandbox counts in one query.
      const workers = await prisma.worker.findMany({
        where: { status: "READY" },
        include: {
          _count: {
            select: {
              sandboxes: {
                where: { status: { in: [...SLOT_CONSUMING_SANDBOX_STATUSES] } },
              },
            },
          },
        },
      });

      // Linear scan: at H.1a scale (10–50 workers per spec §10) pulling READY
      // and choosing in memory is fine. For larger pools, push the comparison
      // to SQL via ORDER BY active_count ASC, free_capacity DESC LIMIT 1.
      let best: { worker: typeof workers[number]; used: number; free: number } | null = null;
      for (const w of workers) {
        const used = w._count.sandboxes;
        const free = w.capacity - used;
        if (free <= 0) continue;
        if (
          !best ||
          used < best.used ||
          (used === best.used && free > best.free)
        ) {
          best = { worker: w, used, free };
        }
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
