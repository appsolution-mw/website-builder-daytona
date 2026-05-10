import { sign } from "./hmac.js";

export interface UserCommitForwarderArgs {
  sandboxId: string;
  brokerHost: string;
  brokerPort: number;
  brokerToken: string;
  hostUrl: string;
  hmacSecret: string;
  pollTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Long-polls the broker for user-edit commits and forwards each to the host.
 * Fire-and-forget; the returned function cancels the loop.
 */
export function runUserCommitForwarder(args: UserCommitForwarderArgs): () => void {
  const fetchFn = args.fetch ?? globalThis.fetch;
  const log = args.log ?? ((m, e) => console.warn(`[user-commit-fwd] ${m}`, e ?? ""));
  const pollTimeoutMs = args.pollTimeoutMs ?? 30_000;
  const brokerBase = `http://${args.brokerHost}:${args.brokerPort}`;
  const pullPath = "/internal/projects/host/git/user-commits/pull";
  const ackPath = "/internal/projects/host/git/user-commits/ack";
  const hostPath = `/api/internal/sandboxes/${encodeURIComponent(args.sandboxId)}/user-commit`;

  let cancelled = false;

  async function loop(): Promise<void> {
    let backoffMs = 1_000;
    while (!cancelled) {
      try {
        const pullRes = await fetchFn(
          `${brokerBase}${pullPath}?timeout=${pollTimeoutMs}`,
          { headers: { authorization: `Bearer ${args.brokerToken}` } },
        );
        if (!pullRes.ok) {
          log(`broker pull returned ${pullRes.status}`);
          await delay(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
          continue;
        }
        backoffMs = 1_000;
        const body = (await pullRes.json()) as { events: unknown[] };
        if (!Array.isArray(body.events) || body.events.length === 0) continue;
        for (const ev of body.events) {
          if (cancelled) return;
          const ok = await postToHost(ev);
          if (ok) await ack((ev as { sha: string }).sha);
        }
      } catch (err) {
        log("forwarder loop error", err);
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  async function postToHost(payload: unknown): Promise<boolean> {
    const body = JSON.stringify(payload);
    const ts = new Date().toISOString();
    const sig = sign({
      secret: args.hmacSecret,
      timestamp: ts,
      method: "POST",
      path: hostPath,
      body,
    });
    try {
      const res = await fetchFn(`${args.hostUrl}${hostPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": sig,
        },
        body,
      });
      if (res.status >= 200 && res.status < 300) return true;
      if (res.status === 409) return true; // already persisted, treat as ack-ok
      log(`host returned ${res.status}`);
      return false;
    } catch (err) {
      log("host POST failed", err);
      return false;
    }
  }

  async function ack(sha: string): Promise<void> {
    try {
      await fetchFn(`${brokerBase}${ackPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${args.brokerToken}`,
        },
        body: JSON.stringify({ sha }),
      });
    } catch (err) {
      log(`ack failed for ${sha}`, err);
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  void loop();
  return () => { cancelled = true; };
}
