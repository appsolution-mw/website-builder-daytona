import { startBroker } from "./ws-server";

const port = Number(process.env.BROKER_PORT ?? 4000);

const perTurnRaw = process.env.BROKER_PER_TURN_USD_CAP ?? "0";
const perTurnParsed = parseFloat(perTurnRaw);
const perTurnCapUsd =
  Number.isFinite(perTurnParsed) && perTurnParsed > 0 ? perTurnParsed : 0;

const handle = await startBroker({ port, perTurnCapUsd });
console.log(`[broker] listening on ws://localhost:${handle.port}`);

const shutdown = async () => {
  console.log("[broker] shutting down…");
  await handle.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
