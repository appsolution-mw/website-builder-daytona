import { createHmac, timingSafeEqual } from "node:crypto";

export function signRequest(args: { body: string; ts: string; secret: string }): string {
  return createHmac("sha256", args.secret).update(`${args.ts}.${args.body}`).digest("hex");
}

export function verifyRequest(args: {
  body: string;
  ts: string;
  sig: string;
  secret: string;
  maxAgeMs: number;
}): boolean {
  const tsNum = Number(args.ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() - tsNum) > args.maxAgeMs) return false;
  const expected = signRequest({ body: args.body, ts: args.ts, secret: args.secret });
  if (expected.length !== args.sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(args.sig, "hex"));
  } catch {
    return false;
  }
}
