import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../index";

describe("createRuntime factory", () => {
  const originalRuntimeMode = process.env.RUNTIME_MODE;
  const originalDaytonaMode = process.env.DAYTONA_MODE;
  const originalSandboxImage = process.env.SANDBOX_IMAGE;
  const originalHmac = process.env.WORKER_AGENT_HMAC_SECRET;
  const originalDisableEnvFileLoad = process.env.WBD_DISABLE_ENV_FILE_LOAD;

  afterEach(() => {
    if (originalRuntimeMode === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = originalRuntimeMode;
    if (originalDaytonaMode === undefined) delete process.env.DAYTONA_MODE;
    else process.env.DAYTONA_MODE = originalDaytonaMode;
    if (originalSandboxImage === undefined) delete process.env.SANDBOX_IMAGE;
    else process.env.SANDBOX_IMAGE = originalSandboxImage;
    if (originalHmac === undefined) delete process.env.WORKER_AGENT_HMAC_SECRET;
    else process.env.WORKER_AGENT_HMAC_SECRET = originalHmac;
    if (originalDisableEnvFileLoad === undefined) delete process.env.WBD_DISABLE_ENV_FILE_LOAD;
    else process.env.WBD_DISABLE_ENV_FILE_LOAD = originalDisableEnvFileLoad;
    vi.resetModules();
  });

  it("uses DAYTONA_MODE=fake when RUNTIME_MODE is unset", () => {
    delete process.env.RUNTIME_MODE;
    process.env.DAYTONA_MODE = "fake";
    const r = createRuntime();
    expect(typeof r.spawnProjectSandbox).toBe("function");
  });

  it("uses RUNTIME_MODE=daytona-fake when explicit", () => {
    process.env.RUNTIME_MODE = "daytona-fake";
    delete process.env.DAYTONA_MODE;
    expect(createRuntime()).toBeDefined();
  });

  it("returns WorkerPoolRuntime for worker-pool-local", () => {
    process.env.RUNTIME_MODE = "worker-pool-local";
    process.env.SANDBOX_IMAGE = "wbd/sandbox:dev";
    process.env.WORKER_AGENT_HMAC_SECRET = "x".repeat(32);
    const r = createRuntime();
    expect(typeof r.spawnProjectSandbox).toBe("function");
  });

  it("throws helpful error if worker-pool-local missing env", () => {
    process.env.RUNTIME_MODE = "worker-pool-local";
    process.env.WBD_DISABLE_ENV_FILE_LOAD = "1";
    delete process.env.SANDBOX_IMAGE;
    delete process.env.WORKER_AGENT_HMAC_SECRET;
    expect(() => createRuntime()).toThrow(/SANDBOX_IMAGE|WORKER_AGENT_HMAC_SECRET/);
  });

  it("throws for worker-pool-hetzner (not yet implemented)", () => {
    process.env.RUNTIME_MODE = "worker-pool-hetzner";
    expect(() => createRuntime()).toThrow(/H\.1c\+/);
  });

  it("throws for legacy hetzner-fake/hetzner-cloud with rename hint", () => {
    process.env.RUNTIME_MODE = "hetzner-fake";
    expect(() => createRuntime()).toThrow(/renamed/);
    process.env.RUNTIME_MODE = "hetzner-cloud";
    expect(() => createRuntime()).toThrow(/renamed/);
  });

  it("throws for unknown mode", () => {
    process.env.RUNTIME_MODE = "magic-cloud";
    expect(() => createRuntime()).toThrow(/Unknown RUNTIME_MODE/);
  });
});
