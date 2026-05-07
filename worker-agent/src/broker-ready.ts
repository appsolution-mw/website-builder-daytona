import { sign } from "./hmac.js";

export interface WatchBrokerReadinessArgs {
  sandboxId: string;
  brokerHost: string;
  brokerPort: number;
  hostUrl: string;
  hmacSecret: string;
  /** Stop polling after this many ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Polling interval. Defaults to 250ms. */
  intervalMs?: number;
  fetch?: typeof globalThis.fetch;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Polls the broker `/health` endpoint inside the just-created sandbox and, on
 * the first successful response, reports back to the host so it can flip
 * `Project.brokerReady = true`. Fire-and-forget — failures are logged.
 */
export function watchBrokerReadiness(args: WatchBrokerReadinessArgs): () => void {
  const fetchFn = args.fetch ?? globalThis.fetch;
  const log = args.log ?? ((m, e) => console.warn(`[broker-ready] ${m}`, e ?? ""));
  const intervalMs = args.intervalMs ?? 250;
  const timeoutMs = args.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  const probeUrl = `http://${args.brokerHost}:${args.brokerPort}/health`;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function probeOnce(): Promise<boolean> {
    try {
      const res = await fetchFn(probeUrl, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function reportReady(): Promise<void> {
    const path = `/api/internal/sandboxes/${encodeURIComponent(args.sandboxId)}/broker-ready`;
    const body = JSON.stringify({});
    const ts = new Date().toISOString();
    const sig = sign({
      secret: args.hmacSecret,
      timestamp: ts,
      method: "POST",
      path,
      body,
    });
    try {
      const res = await fetchFn(`${args.hostUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": sig,
        },
        body,
      });
      if (!res.ok) {
        log(`host returned ${res.status} for ${args.sandboxId}`);
      }
    } catch (err) {
      log(`failed to notify host for ${args.sandboxId}`, err);
    }
  }

  async function tick(): Promise<void> {
    if (cancelled) return;
    if (Date.now() > deadline) {
      log(`broker readiness timeout for ${args.sandboxId} after ${timeoutMs}ms`);
      return;
    }
    const ok = await probeOnce();
    if (cancelled) return;
    if (ok) {
      await reportReady();
      return;
    }
    timer = setTimeout(() => void tick(), intervalMs);
  }

  void tick();

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
