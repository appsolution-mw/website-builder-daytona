import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  assertSafeTestDatabase(connectionString);
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function assertSafeTestDatabase(connectionString: string): void {
  if (!process.env.VITEST) return;

  let databaseName = "";
  try {
    databaseName = new URL(connectionString).pathname.replace(/^\/+/, "");
  } catch {
    return;
  }

  if (databaseName && !/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to run DB tests against non-test database "${databaseName}". ` +
        "Set TEST_DATABASE_URL to an isolated test database.",
    );
  }
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
