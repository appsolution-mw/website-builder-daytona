import { sign } from "./hmac.js";

export interface HeartbeatBody {
  runningSandboxes: number;
  dockerVersion: string;
  uptime: number;
}

export interface StartHeartbeatArgs {
  hostUrl: string;
  workerId: string;
  hmacSecret: string;
  intervalMs?: number;
  fetch?: typeof globalThis.fetch;
  sample: () => HeartbeatBody;
  log?: (msg: string, err?: unknown) => void;
}

export function startHeartbeat(args: StartHeartbeatArgs): () => void {
  const interval = args.intervalMs ?? 10_000;
  const fetchFn = args.fetch ?? globalThis.fetch;
  const log = args.log ?? ((m, e) => console.warn(`[heartbeat] ${m}`, e ?? ""));
  const path = `/api/internal/workers/${args.workerId}/heartbeat`;
  const url = `${args.hostUrl}${path}`;

  async function tick() {
    try {
      const body = JSON.stringify(args.sample());
      const ts = new Date().toISOString();
      const sig = sign({
        secret: args.hmacSecret,
        timestamp: ts, method: "POST", path, body,
      });
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": sig,
        },
        body,
      });
      if (!res.ok) log(`non-2xx ${res.status}`);
    } catch (err) {
      log("network error", err);
    }
  }

  const id = setInterval(tick, interval);
  return () => clearInterval(id);
}
