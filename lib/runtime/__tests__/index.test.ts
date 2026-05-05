import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../index";

describe("createRuntime factory", () => {
  const originalRuntimeMode = process.env.RUNTIME_MODE;
  const originalDaytonaMode = process.env.DAYTONA_MODE;
  const originalSandboxImage = process.env.SANDBOX_IMAGE;
  const originalWorkerAgentImage = process.env.WORKER_AGENT_IMAGE;
  const originalHmac = process.env.WORKER_AGENT_HMAC_SECRET;
  const originalDisableEnvFileLoad = process.env.WBD_DISABLE_ENV_FILE_LOAD;
  const originalHetznerApiToken = process.env.HETZNER_API_TOKEN;
  const originalTailscaleApiKey = process.env.TAILSCALE_API_KEY;
  const originalTailscaleTailnet = process.env.TAILSCALE_TAILNET;
  const originalAppBaseUrl = process.env.APP_BASE_URL;

  afterEach(() => {
    if (originalRuntimeMode === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = originalRuntimeMode;
    if (originalDaytonaMode === undefined) delete process.env.DAYTONA_MODE;
    else process.env.DAYTONA_MODE = originalDaytonaMode;
    if (originalSandboxImage === undefined) delete process.env.SANDBOX_IMAGE;
    else process.env.SANDBOX_IMAGE = originalSandboxImage;
    if (originalWorkerAgentImage === undefined) delete process.env.WORKER_AGENT_IMAGE;
    else process.env.WORKER_AGENT_IMAGE = originalWorkerAgentImage;
    if (originalHmac === undefined) delete process.env.WORKER_AGENT_HMAC_SECRET;
    else process.env.WORKER_AGENT_HMAC_SECRET = originalHmac;
    if (originalDisableEnvFileLoad === undefined) delete process.env.WBD_DISABLE_ENV_FILE_LOAD;
    else process.env.WBD_DISABLE_ENV_FILE_LOAD = originalDisableEnvFileLoad;
    if (originalHetznerApiToken === undefined) delete process.env.HETZNER_API_TOKEN;
    else process.env.HETZNER_API_TOKEN = originalHetznerApiToken;
    if (originalTailscaleApiKey === undefined) delete process.env.TAILSCALE_API_KEY;
    else process.env.TAILSCALE_API_KEY = originalTailscaleApiKey;
    if (originalTailscaleTailnet === undefined) delete process.env.TAILSCALE_TAILNET;
    else process.env.TAILSCALE_TAILNET = originalTailscaleTailnet;
    if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalAppBaseUrl;
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

  it("returns WorkerPoolRuntime for worker-pool-hetzner", () => {
    process.env.RUNTIME_MODE = "worker-pool-hetzner";
    process.env.WBD_DISABLE_ENV_FILE_LOAD = "1";
    process.env.SANDBOX_IMAGE = "wbd/sandbox:dev";
    process.env.WORKER_AGENT_IMAGE = "wbd/worker-agent:dev";
    process.env.WORKER_AGENT_HMAC_SECRET = "x".repeat(32);
    process.env.HETZNER_API_TOKEN = "hetzner-token";
    process.env.TAILSCALE_API_KEY = "tailscale-key";
    process.env.TAILSCALE_TAILNET = "example.ts.net";
    process.env.APP_BASE_URL = "https://app.example.com";

    const runtime = createRuntime();

    expect(typeof runtime.spawnProjectSandbox).toBe("function");
  });

  it("throws helpful error if worker-pool-hetzner missing env", () => {
    process.env.RUNTIME_MODE = "worker-pool-hetzner";
    process.env.WBD_DISABLE_ENV_FILE_LOAD = "1";
    delete process.env.SANDBOX_IMAGE;
    delete process.env.WORKER_AGENT_IMAGE;
    delete process.env.WORKER_AGENT_HMAC_SECRET;
    delete process.env.HETZNER_API_TOKEN;
    delete process.env.TAILSCALE_API_KEY;
    delete process.env.TAILSCALE_TAILNET;
    delete process.env.APP_BASE_URL;

    expect(() => createRuntime()).toThrow(
      /SANDBOX_IMAGE|WORKER_AGENT_IMAGE|WORKER_AGENT_HMAC_SECRET|HETZNER_API_TOKEN|TAILSCALE_API_KEY|TAILSCALE_TAILNET|APP_BASE_URL/,
    );
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
