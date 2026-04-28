import { startBroker } from "./ws-server";

const port = Number(process.env.BROKER_PORT ?? 4000);

const handle = await startBroker({ port });
console.log(`[broker] listening on ws://localhost:${handle.port}`);

const shutdown = async () => {
  console.log("[broker] shutting down…");
  await handle.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
