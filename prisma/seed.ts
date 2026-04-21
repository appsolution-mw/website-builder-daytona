import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const devUserId = process.env.DEV_USER_ID ?? "dev-user";
  await prisma.user.upsert({
    where: { id: devUserId },
    update: {},
    create: { id: devUserId, email: "dev@localhost" },
  });
  console.log(`Seeded user: ${devUserId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
