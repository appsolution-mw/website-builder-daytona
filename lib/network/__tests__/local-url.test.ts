import { describe, expect, it } from "vitest";

import { localHttpUrlForBrowserPort } from "../local-url";

describe("localHttpUrlForBrowserPort", () => {
  it("uses the browser hostname so LAN clients do not receive loopback preview URLs", () => {
    expect(localHttpUrlForBrowserPort(33002, "192.168.1.50")).toBe("http://192.168.1.50:33002");
  });

  it("falls back to loopback when no browser hostname is available", () => {
    expect(localHttpUrlForBrowserPort(33002)).toBe("http://127.0.0.1:33002");
  });
});
