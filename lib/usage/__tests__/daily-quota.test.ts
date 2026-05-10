import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/db/client";
import {
  getDailyQuotaState,
  getUserDailySpend,
  nextUtcMidnight,
  readDailyQuotaConfigFromEnv,
  startOfUtcDay,
} from "../daily-quota";

const USER_ID = "daily-quota-test-user";
const PROJECT_ID = "daily-quota-test-project";

async function cleanDatabase(): Promise<void> {
  await prisma.tokenUsage.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

async function seedProject(): Promise<void> {
  await prisma.user.create({ data: { id: USER_ID, email: "q@example.com" } });
  await prisma.project.create({
    data: { id: PROJECT_ID, ownerId: USER_ID, name: "Daily Quota Test" },
  });
}

async function seedUsage(input: {
  costUsd: number;
  createdAt: Date;
  turnId?: string;
}): Promise<void> {
  await prisma.tokenUsage.create({
    data: {
      projectId: PROJECT_ID,
      turnId: input.turnId ?? `turn-${Math.random().toString(36).slice(2, 10)}`,
      label: "TURN",
      runtime: "CLAUDE_CODE",
      modelId: "test",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: input.costUsd,
      createdAt: input.createdAt,
    },
  });
}

describe("startOfUtcDay", () => {
  it("returns midnight UTC for an afternoon timestamp", () => {
    const noon = new Date("2026-05-11T15:23:45.123Z");
    const start = startOfUtcDay(noon);
    expect(start.toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });

  it("is idempotent at midnight UTC", () => {
    const mid = new Date("2026-05-11T00:00:00.000Z");
    expect(startOfUtcDay(mid).toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });
});

describe("nextUtcMidnight", () => {
  it("returns the next midnight UTC", () => {
    const now = new Date("2026-05-11T15:23:45.123Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });

  it("at midnight UTC returns the following midnight", () => {
    const mid = new Date("2026-05-11T00:00:00.000Z");
    expect(nextUtcMidnight(mid).toISOString()).toBe("2026-05-12T00:00:00.000Z");
  });
});

describe("readDailyQuotaConfigFromEnv", () => {
  const original = {
    daily: process.env.DEFAULT_DAILY_USD_CAP,
    perTurn: process.env.DEFAULT_PER_TURN_USD_CAP,
  };
  afterEach(() => {
    if (original.daily === undefined) delete process.env.DEFAULT_DAILY_USD_CAP;
    else process.env.DEFAULT_DAILY_USD_CAP = original.daily;
    if (original.perTurn === undefined) delete process.env.DEFAULT_PER_TURN_USD_CAP;
    else process.env.DEFAULT_PER_TURN_USD_CAP = original.perTurn;
  });

  it("returns 0 / 0 when unset", () => {
    delete process.env.DEFAULT_DAILY_USD_CAP;
    delete process.env.DEFAULT_PER_TURN_USD_CAP;
    expect(readDailyQuotaConfigFromEnv()).toEqual({
      dailyCapUsd: 0,
      perTurnCapUsd: 0,
    });
  });

  it("parses valid floats", () => {
    process.env.DEFAULT_DAILY_USD_CAP = "5.00";
    process.env.DEFAULT_PER_TURN_USD_CAP = "1.25";
    expect(readDailyQuotaConfigFromEnv()).toEqual({
      dailyCapUsd: 5,
      perTurnCapUsd: 1.25,
    });
  });

  it("treats unparseable values as 0", () => {
    process.env.DEFAULT_DAILY_USD_CAP = "abc";
    process.env.DEFAULT_PER_TURN_USD_CAP = "";
    expect(readDailyQuotaConfigFromEnv()).toEqual({
      dailyCapUsd: 0,
      perTurnCapUsd: 0,
    });
  });
});

describe("getUserDailySpend", () => {
  beforeEach(async () => {
    await cleanDatabase();
    await seedProject();
  });
  afterEach(async () => {
    await cleanDatabase();
  });

  it("returns 0 with no usage rows", async () => {
    const spend = await getUserDailySpend(prisma, {
      ownerId: USER_ID,
      now: new Date("2026-05-11T12:00:00.000Z"),
    });
    expect(spend).toBe(0);
  });

  it("sums today's usage; ignores yesterday's", async () => {
    await seedUsage({ costUsd: 0.50, createdAt: new Date("2026-05-10T22:00:00.000Z") });
    await seedUsage({ costUsd: 1.20, createdAt: new Date("2026-05-11T05:00:00.000Z") });
    await seedUsage({ costUsd: 0.30, createdAt: new Date("2026-05-11T19:00:00.000Z") });
    const spend = await getUserDailySpend(prisma, {
      ownerId: USER_ID,
      now: new Date("2026-05-11T23:00:00.000Z"),
    });
    expect(spend).toBeCloseTo(1.5, 6);
  });

  it("ignores other users' projects", async () => {
    await prisma.user.create({ data: { id: "other-user", email: "o@example.com" } });
    await prisma.project.create({
      data: { id: "other-project", ownerId: "other-user", name: "Other" },
    });
    await prisma.tokenUsage.create({
      data: {
        projectId: "other-project",
        turnId: "t1",
        label: "TURN",
        runtime: "CLAUDE_CODE",
        modelId: "test",
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        costUsd: 99,
        createdAt: new Date("2026-05-11T12:00:00.000Z"),
      },
    });
    const spend = await getUserDailySpend(prisma, {
      ownerId: USER_ID,
      now: new Date("2026-05-11T15:00:00.000Z"),
    });
    expect(spend).toBe(0);
    await prisma.tokenUsage.deleteMany({ where: { projectId: "other-project" } });
    await prisma.project.deleteMany({ where: { id: "other-project" } });
    await prisma.user.deleteMany({ where: { id: "other-user" } });
  });
});

describe("getDailyQuotaState", () => {
  const original = {
    daily: process.env.DEFAULT_DAILY_USD_CAP,
    perTurn: process.env.DEFAULT_PER_TURN_USD_CAP,
  };

  beforeEach(async () => {
    process.env.DEFAULT_DAILY_USD_CAP = "5.00";
    process.env.DEFAULT_PER_TURN_USD_CAP = "1.00";
    await cleanDatabase();
    await seedProject();
  });
  afterEach(async () => {
    if (original.daily === undefined) delete process.env.DEFAULT_DAILY_USD_CAP;
    else process.env.DEFAULT_DAILY_USD_CAP = original.daily;
    if (original.perTurn === undefined) delete process.env.DEFAULT_PER_TURN_USD_CAP;
    else process.env.DEFAULT_PER_TURN_USD_CAP = original.perTurn;
    await cleanDatabase();
  });

  it("composes spend + cap + resetsAt with exceeded=false", async () => {
    await seedUsage({ costUsd: 2, createdAt: new Date("2026-05-11T10:00:00.000Z") });
    const state = await getDailyQuotaState(
      prisma,
      USER_ID,
      new Date("2026-05-11T12:00:00.000Z"),
    );
    expect(state.todaySpend).toBe(2);
    expect(state.dailyCap).toBe(5);
    expect(state.perTurnCap).toBe(1);
    expect(state.exceeded).toBe(false);
    expect(state.resetsAt).toBe("2026-05-12T00:00:00.000Z");
  });

  it("flags exceeded=true at the cap", async () => {
    await seedUsage({ costUsd: 5, createdAt: new Date("2026-05-11T10:00:00.000Z") });
    const state = await getDailyQuotaState(
      prisma,
      USER_ID,
      new Date("2026-05-11T12:00:00.000Z"),
    );
    expect(state.exceeded).toBe(true);
  });

  it("flags exceeded=false when dailyCap is 0 (disabled)", async () => {
    process.env.DEFAULT_DAILY_USD_CAP = "0";
    await seedUsage({ costUsd: 99, createdAt: new Date("2026-05-11T10:00:00.000Z") });
    const state = await getDailyQuotaState(
      prisma,
      USER_ID,
      new Date("2026-05-11T12:00:00.000Z"),
    );
    expect(state.dailyCap).toBe(0);
    expect(state.exceeded).toBe(false);
  });
});
