import { describe, expect, it } from "vitest";
import { sign, verify } from "../src/hmac.js";

const SECRET = "test-secret-32-chars-minimum-please";

describe("hmac", () => {
  it("sign produces a 64-char hex digest", () => {
    const sig = sign({
      secret: SECRET,
      timestamp: "2026-04-28T00:00:00.000Z",
      method: "POST",
      path: "/sandboxes",
      body: '{"hello":"world"}',
    });
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verify accepts a freshly signed message", () => {
    const ts = new Date().toISOString();
    const sig = sign({
      secret: SECRET,
      timestamp: ts,
      method: "POST",
      path: "/sandboxes",
      body: "x",
    });
    const result = verify({
      secret: SECRET,
      timestamp: ts,
      method: "POST",
      path: "/sandboxes",
      body: "x",
      signature: sig,
      now: new Date(ts),
    });
    expect(result.ok).toBe(true);
  });

  it("verify rejects mismatched signature", () => {
    const ts = new Date().toISOString();
    const result = verify({
      secret: SECRET,
      timestamp: ts,
      method: "POST",
      path: "/sandboxes",
      body: "x",
      signature: "deadbeef".repeat(8),
      now: new Date(ts),
    });
    expect(result).toEqual({ ok: false, reason: "signature-mismatch" });
  });

  it("verify rejects timestamps older than 5 minutes", () => {
    const ts = new Date(Date.now() - 6 * 60_000).toISOString();
    const sig = sign({ secret: SECRET, timestamp: ts, method: "GET", path: "/x", body: "" });
    const result = verify({
      secret: SECRET, timestamp: ts, method: "GET", path: "/x", body: "",
      signature: sig, now: new Date(),
    });
    expect(result).toEqual({ ok: false, reason: "timestamp-out-of-window" });
  });

  it("verify rejects timestamps more than 5 minutes in the future", () => {
    const ts = new Date(Date.now() + 6 * 60_000).toISOString();
    const sig = sign({ secret: SECRET, timestamp: ts, method: "GET", path: "/x", body: "" });
    const result = verify({
      secret: SECRET, timestamp: ts, method: "GET", path: "/x", body: "",
      signature: sig, now: new Date(),
    });
    expect(result).toEqual({ ok: false, reason: "timestamp-out-of-window" });
  });

  it("verify rejects unparseable timestamps", () => {
    const result = verify({
      secret: SECRET, timestamp: "not-a-date", method: "GET", path: "/x", body: "",
      signature: "0".repeat(64), now: new Date(),
    });
    expect(result).toEqual({ ok: false, reason: "timestamp-invalid" });
  });
});
