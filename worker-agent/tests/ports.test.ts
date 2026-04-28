import { describe, expect, it } from "vitest";
import { pickFreePort, PortRange } from "../src/ports.js";
import * as net from "node:net";

const RANGE: PortRange = { min: 30000, max: 39999 };

async function bindPort(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(port, "127.0.0.1");
    srv.once("listening", () => resolve({
      close: () => new Promise((r) => srv.close(() => r())),
    }));
    srv.once("error", reject);
  });
}

describe("pickFreePort", () => {
  it("returns a port within the configured range", async () => {
    const p = await pickFreePort(RANGE);
    expect(p).toBeGreaterThanOrEqual(RANGE.min);
    expect(p).toBeLessThanOrEqual(RANGE.max);
  });

  it("returns different ports on consecutive calls", async () => {
    const a = await pickFreePort(RANGE);
    const b = await pickFreePort({ ...RANGE, exclude: new Set([a]) });
    expect(a).not.toBe(b);
  });

  it("avoids ports passed via `exclude`", async () => {
    const exclude = new Set<number>();
    for (let p = RANGE.min; p < RANGE.min + 50; p++) exclude.add(p);
    const picked = await pickFreePort({ ...RANGE, exclude });
    expect(exclude.has(picked)).toBe(false);
  });

  it("avoids actually bound ports", async () => {
    // Bind a port and ensure pickFreePort does not return it
    const bound = await bindPort(31999);
    try {
      // Loop a few times — any return value just must not equal 31999
      for (let i = 0; i < 5; i++) {
        const p = await pickFreePort({ min: 31999, max: 32000 });
        expect(p).toBe(32000);
      }
    } finally {
      await bound.close();
    }
  });

  it("throws when the entire range is exhausted", async () => {
    const exclude = new Set<number>();
    for (let p = 35000; p <= 35001; p++) exclude.add(p);
    await expect(pickFreePort({ min: 35000, max: 35001, exclude })).rejects.toThrow(/exhaust/i);
  });
});
