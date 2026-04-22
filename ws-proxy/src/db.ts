import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  (globalThis as { __wbdPrisma?: PrismaClient }).__wbdPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  (globalThis as { __wbdPrisma?: PrismaClient }).__wbdPrisma = prisma;
}
