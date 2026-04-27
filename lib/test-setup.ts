/**
 * Vitest global setup: load .env variables into process.env for tests
 * that need DATABASE_URL and other env vars (e.g. DB-backed tests).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not present — fine in CI where env vars are injected directly
}
