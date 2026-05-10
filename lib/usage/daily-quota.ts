import type { PrismaClient } from "@prisma/client";

export interface DailyQuotaConfig {
  dailyCapUsd: number;        // 0 = disabled
  perTurnCapUsd: number;      // 0 = disabled
}

export interface DailyQuotaState {
  todaySpend: number;
  dailyCap: number;
  perTurnCap: number;
  resetsAt: string;           // ISO-8601, next UTC midnight
  exceeded: boolean;
}

export function readDailyQuotaConfigFromEnv(): DailyQuotaConfig {
  const dailyRaw = process.env.DEFAULT_DAILY_USD_CAP ?? "0";
  const perTurnRaw = process.env.DEFAULT_PER_TURN_USD_CAP ?? "0";
  const dailyParsed = parseFloat(dailyRaw);
  const perTurnParsed = parseFloat(perTurnRaw);
  return {
    dailyCapUsd: Number.isFinite(dailyParsed) && dailyParsed > 0 ? dailyParsed : 0,
    perTurnCapUsd: Number.isFinite(perTurnParsed) && perTurnParsed > 0 ? perTurnParsed : 0,
  };
}

export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
}

export function nextUtcMidnight(now: Date = new Date()): Date {
  const d = startOfUtcDay(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export interface DailySpendQuery {
  ownerId: string;
  now?: Date;
}

export async function getUserDailySpend(
  prisma: PrismaClient,
  q: DailySpendQuery,
): Promise<number> {
  const startOfDay = startOfUtcDay(q.now);
  const agg = await prisma.tokenUsage.aggregate({
    _sum: { costUsd: true },
    where: {
      project: { ownerId: q.ownerId },
      createdAt: { gte: startOfDay },
    },
  });
  return agg._sum.costUsd ? Number(agg._sum.costUsd) : 0;
}

export async function getDailyQuotaState(
  prisma: PrismaClient,
  ownerId: string,
  now: Date = new Date(),
): Promise<DailyQuotaState> {
  const config = readDailyQuotaConfigFromEnv();
  const todaySpend = await getUserDailySpend(prisma, { ownerId, now });
  return {
    todaySpend,
    dailyCap: config.dailyCapUsd,
    perTurnCap: config.perTurnCapUsd,
    resetsAt: nextUtcMidnight(now).toISOString(),
    exceeded: config.dailyCapUsd > 0 && todaySpend >= config.dailyCapUsd,
  };
}
