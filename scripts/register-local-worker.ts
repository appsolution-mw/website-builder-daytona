import { prisma } from "../lib/db/client";

const id = process.env.WORKER_ID ?? "local-1";

async function main() {
  const w = await prisma.worker.upsert({
    where: { id },
    create: {
      id,
      name: "Local dev worker",
      tailscaleHostname: "local-dev",
      tailscaleIp: "127.0.0.1",
      provider: "fake",
      providerVmId: "local-1",
      region: "local",
      capacity: 8,
      status: "READY",
    },
    update: { status: "READY", lastHeartbeatAt: new Date() },
  });
  console.log(`registered local worker id=${w.id} ip=${w.tailscaleIp}`);
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
