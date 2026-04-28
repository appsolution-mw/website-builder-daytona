import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 5 * 60 * 1000;

export interface SignArgs {
  secret: string;
  timestamp: string;       // ISO-8601
  method: string;          // "POST" / "GET" / "DELETE"
  path: string;            // "/sandboxes"
  body: string;            // raw body string ("" for GET/DELETE)
}

export function sign(args: SignArgs): string {
  const payload = `${args.timestamp}.${args.method}.${args.path}.${args.body}`;
  return createHmac("sha256", args.secret).update(payload).digest("hex");
}

export type VerifyReason =
  | "timestamp-invalid"
  | "timestamp-out-of-window"
  | "signature-malformed"
  | "signature-mismatch";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: VerifyReason };

export interface VerifyArgs extends SignArgs {
  signature: string;
  now: Date;
}

export function verify(args: VerifyArgs): VerifyResult {
  const ts = Date.parse(args.timestamp);
  if (Number.isNaN(ts)) return { ok: false, reason: "timestamp-invalid" };
  const drift = Math.abs(args.now.getTime() - ts);
  if (drift > WINDOW_MS) return { ok: false, reason: "timestamp-out-of-window" };

  if (!/^[a-f0-9]{64}$/.test(args.signature)) {
    return { ok: false, reason: "signature-malformed" };
  }
  const expected = sign(args);
  const got = Buffer.from(args.signature, "hex");
  const exp = Buffer.from(expected, "hex");
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
    return { ok: false, reason: "signature-mismatch" };
  }
  return { ok: true };
}
