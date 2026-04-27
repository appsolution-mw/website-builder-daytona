import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../index";

describe("createRuntime factory", () => {
  const originalRuntimeMode = process.env.RUNTIME_MODE;
  const originalDaytonaMode = process.env.DAYTONA_MODE;

  afterEach(() => {
    if (originalRuntimeMode === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = originalRuntimeMode;
    if (originalDaytonaMode === undefined) delete process.env.DAYTONA_MODE;
    else process.env.DAYTONA_MODE = originalDaytonaMode;
    vi.resetModules();
  });

  it("uses DAYTONA_MODE=fake when RUNTIME_MODE is unset", () => {
    delete process.env.RUNTIME_MODE;
    process.env.DAYTONA_MODE = "fake";
    const r = createRuntime();
    expect(r).toBeDefined();
    expect(typeof r.spawnProjectSandbox).toBe("function");
  });

  it("uses RUNTIME_MODE=daytona-fake when explicit", () => {
    process.env.RUNTIME_MODE = "daytona-fake";
    delete process.env.DAYTONA_MODE;
    const r = createRuntime();
    expect(r).toBeDefined();
  });

  it("throws for hetzner-* (not yet implemented)", () => {
    process.env.RUNTIME_MODE = "hetzner-fake";
    expect(() => createRuntime()).toThrowError(/H\.1c\+/);
  });

  it("throws for unknown mode", () => {
    process.env.RUNTIME_MODE = "magic-cloud";
    expect(() => createRuntime()).toThrowError(/Unknown RUNTIME_MODE/);
  });
});
