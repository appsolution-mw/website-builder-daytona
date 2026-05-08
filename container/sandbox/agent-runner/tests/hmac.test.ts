import { describe, it, expect } from "vitest";
import { signRequest, verifyRequest } from "../src/hmac.js";

describe("hmac", () => {
  const secret = "topsecret";

  it("round-trips a signed body", () => {
    const body = JSON.stringify({ a: 1 });
    const ts = Date.now().toString();
    const sig = signRequest({ body, ts, secret });
    expect(verifyRequest({ body, ts, sig, secret, maxAgeMs: 60_000 })).toBe(true);
  });

  it("rejects an expired timestamp", () => {
    const body = "{}";
    const ts = (Date.now() - 5 * 60_000).toString();
    const sig = signRequest({ body, ts, secret });
    expect(verifyRequest({ body, ts, sig, secret, maxAgeMs: 60_000 })).toBe(false);
  });

  it("rejects a tampered body", () => {
    const ts = Date.now().toString();
    const sig = signRequest({ body: "{}", ts, secret });
    expect(verifyRequest({ body: "{}}", ts, sig, secret, maxAgeMs: 60_000 })).toBe(false);
  });

  it("rejects a different secret", () => {
    const ts = Date.now().toString();
    const sig = signRequest({ body: "{}", ts, secret: "other" });
    expect(verifyRequest({ body: "{}", ts, sig, secret, maxAgeMs: 60_000 })).toBe(false);
  });

  it("rejects malformed timestamp", () => {
    expect(verifyRequest({ body: "{}", ts: "not-a-number", sig: "00", secret, maxAgeMs: 60_000 })).toBe(false);
  });

  it("rejects malformed signature length without throwing", () => {
    const ts = Date.now().toString();
    expect(verifyRequest({ body: "{}", ts, sig: "abc", secret, maxAgeMs: 60_000 })).toBe(false);
  });
});
