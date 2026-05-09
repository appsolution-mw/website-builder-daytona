import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../db/client";
import type { HetznerClient } from "../hetzner-client";
import {
  createHetznerProvisioner,
  createHetznerWorkerProvisionerFromEnv,
} from "../hetzner";
import type { TailscaleClient } from "../tailscale-client";

function createMockHetznerClient(): HetznerClient {
  return {
    createServer: vi.fn<HetznerClient["createServer"]>(async (args) => ({
      id: "123",
      name: args.name,
      publicIpv4: "203.0.113.10",
    })),
    deleteServer: vi.fn<HetznerClient["deleteServer"]>(async () => undefined),
  };
}

function createMockTailscaleClient(): TailscaleClient {
  return {
    createAuthKey: vi.fn<TailscaleClient["createAuthKey"]>(
      async () => ({ id: "k123", key: "tskey-auth-test" }),
    ),
    deleteAuthKey: vi.fn<TailscaleClient["deleteAuthKey"]>(async () => undefined),
    findDeviceIpByHostname: vi.fn<TailscaleClient["findDeviceIpByHostname"]>(
      async () => "100.64.1.25",
    ),
  };
}

describe("HetznerProvisioner", () => {
  beforeEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  afterEach(async () => {
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
  });

  it("provision() creates a PROVISIONING Hetzner worker and bootstraps the VM", async () => {
    const hetzner = createMockHetznerClient();
    const tailscale = createMockTailscaleClient();
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale,
      workerAgentImage: "registry.example.com/wbd/worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com/",
      sandboxImage: "registry.example.com/wbd/sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
      tailscaleTags: ["tag:wbd-worker"],
      tailscaleAuthKeyExpirySeconds: 900,
    });

    const worker = await provisioner.provision({
      region: "fsn1",
      size: "ccx33",
      capacity: 10,
      name: "wbd-worker-test",
    });

    expect(provisioner.providerId).toBe("hetzner");
    expect(worker).toEqual(
      expect.objectContaining({
        name: "wbd-worker-test",
        tailscaleHostname: "wbd-worker-test",
        tailscaleIp: "100.64.1.25",
        provider: "hetzner",
        providerVmId: "123",
        region: "fsn1",
        capacity: 10,
        serverType: "ccx33",
        status: "PROVISIONING",
      }),
    );
    expect(tailscale.createAuthKey).toHaveBeenCalledWith({
      description: expect.stringContaining(worker.id),
      tags: ["tag:wbd-worker"],
      reusable: false,
      expirySeconds: 900,
    });
    expect(hetzner.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "wbd-worker-test",
        serverType: "ccx33",
        image: "ubuntu-24.04",
        location: "fsn1",
        labels: expect.objectContaining({
          app: "website-builder-daytona",
          provider: "hetzner",
          workerId: worker.id,
        }),
      }),
    );

    const createServerArgs = vi.mocked(hetzner.createServer).mock.calls[0][0];
    expect(createServerArgs.userData).toContain(`WORKER_ID=${worker.id}`);
    expect(createServerArgs.userData).toContain("registry.example.com/wbd/worker-agent:test");
    expect(createServerArgs.userData).toContain("HMAC_SECRET=agent-secret");
    expect(createServerArgs.userData).toContain("HOST_URL=https://app.example.com");
    expect(createServerArgs.userData).toContain(
      "SANDBOX_IMAGE=registry.example.com/wbd/sandbox:test",
    );
    expect(createServerArgs.userData).toContain("tailscale up --auth-key tskey-auth-test");
    expect(tailscale.findDeviceIpByHostname).toHaveBeenCalledWith("wbd-worker-test");

    const row = await prisma.worker.findUnique({ where: { id: worker.id } });
    expect(row).toEqual(
      expect.objectContaining({
        name: "wbd-worker-test",
        tailscaleHostname: "wbd-worker-test",
        tailscaleIp: "100.64.1.25",
        provider: "hetzner",
        providerVmId: "123",
        region: "fsn1",
        capacity: 10,
        serverType: "ccx33",
        provisioningError: null,
        status: "PROVISIONING",
      }),
    );
  });

  it("provision() records provisioningError and rethrows when VM creation fails", async () => {
    const hetzner = createMockHetznerClient();
    const tailscale = createMockTailscaleClient();
    vi.mocked(hetzner.createServer).mockRejectedValueOnce(new Error("hcloud unavailable"));
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale,
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
    });

    await expect(
      provisioner.provision({
        region: "fsn1",
        size: "ccx33",
        capacity: 4,
        name: "wbd-worker-fail",
      }),
    ).rejects.toThrow("hcloud unavailable");

    const row = await prisma.worker.findFirst({
      where: { provider: "hetzner", name: "wbd-worker-fail" },
    });
    expect(row).toEqual(
      expect.objectContaining({
        providerVmId: "pending",
        provisioningError: "hcloud unavailable",
        status: "PROVISIONING",
      }),
    );
    expect(tailscale.deleteAuthKey).toHaveBeenCalledWith("k123");
  });

  it("provision() waits for a Tailscale IPv4 instead of using the public IPv4", async () => {
    const hetzner = createMockHetznerClient();
    const tailscale = createMockTailscaleClient();
    vi.mocked(tailscale.findDeviceIpByHostname)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("100.64.1.88");
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale,
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
      tailscaleLookupAttempts: 2,
      tailscaleLookupIntervalMs: 1,
      sleep,
    });

    const worker = await provisioner.provision({
      region: "hel1",
      size: "cpx31",
      capacity: 6,
      name: "wbd-worker-tailnet-ip",
    });

    expect(worker.tailscaleIp).toBe("100.64.1.88");
    expect(worker.tailscaleIp).not.toBe("203.0.113.10");
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it("provision() stores providerVmId before failing when Tailscale never becomes ready", async () => {
    const hetzner = createMockHetznerClient();
    const tailscale = createMockTailscaleClient();
    vi.mocked(tailscale.findDeviceIpByHostname).mockResolvedValue(null);
    vi.mocked(hetzner.deleteServer).mockRejectedValueOnce(new Error("delete failed"));
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale,
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
      tailscaleLookupAttempts: 1,
    });

    await expect(
      provisioner.provision({
        region: "hel1",
        size: "cpx31",
        capacity: 6,
        name: "wbd-worker-no-tailnet-ip",
      }),
    ).rejects.toThrow("Tailscale device did not become ready for wbd-worker-no-tailnet-ip");

    const row = await prisma.worker.findFirst({
      where: { provider: "hetzner", name: "wbd-worker-no-tailnet-ip" },
    });
    expect(row).toEqual(
      expect.objectContaining({
        providerVmId: "123",
        tailscaleIp: "",
        provisioningError: "Tailscale device did not become ready for wbd-worker-no-tailnet-ip",
      }),
    );
    expect(hetzner.deleteServer).toHaveBeenCalledWith("123");
    expect(tailscale.deleteAuthKey).toHaveBeenCalledWith("k123");
  });

  it("destroy() deletes the known Hetzner server and marks the worker decommissioned", async () => {
    const hetzner = createMockHetznerClient();
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale: createMockTailscaleClient(),
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
    });
    const worker = await provisioner.provision({
      region: "fsn1",
      size: "ccx33",
      capacity: 2,
      name: "wbd-worker-destroy",
    });

    await provisioner.destroy(worker.id);

    expect(hetzner.deleteServer).toHaveBeenCalledWith("123");
    const row = await prisma.worker.findUnique({ where: { id: worker.id } });
    expect(row?.status).toBe("DECOMMISSIONED");
    expect(row?.decommissionedAt).toBeInstanceOf(Date);
    expect(row?.tailscaleHostname).toBe(`${worker.tailscaleHostname}-decommissioned-${worker.id.slice(0, 8)}`);
  });

  it("destroy() is idempotent for missing and non-Hetzner workers", async () => {
    const hetzner = createMockHetznerClient();
    const provisioner = createHetznerProvisioner({
      hetzner,
      tailscale: createMockTailscaleClient(),
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
    });
    const otherWorker = await prisma.worker.create({
      data: {
        name: "fake-worker",
        tailscaleHostname: "fake-worker",
        tailscaleIp: "100.64.9.9",
        provider: "fake",
        providerVmId: "fake-1",
        region: "fsn1",
        capacity: 1,
        status: "READY",
      },
    });

    await expect(provisioner.destroy("does-not-exist")).resolves.toBeUndefined();
    await expect(provisioner.destroy(otherWorker.id)).resolves.toBeUndefined();

    expect(hetzner.deleteServer).not.toHaveBeenCalled();
    const row = await prisma.worker.findUnique({ where: { id: otherWorker.id } });
    expect(row?.status).toBe("READY");
  });

  it("listOwned() returns non-decommissioned Hetzner workers only", async () => {
    const provisioner = createHetznerProvisioner({
      hetzner: createMockHetznerClient(),
      tailscale: createMockTailscaleClient(),
      workerAgentImage: "worker-agent:test",
      workerAgentHmacSecret: "agent-secret",
      appBaseUrl: "https://app.example.com",
      sandboxImage: "sandbox:test",
      watchtowerHttpApiToken: "watchtower-token",
    });
    const active = await provisioner.provision({
      region: "fsn1",
      size: "ccx33",
      capacity: 2,
      name: "wbd-worker-active",
    });
    const decommissioned = await provisioner.provision({
      region: "hel1",
      size: "ccx23",
      capacity: 2,
      name: "wbd-worker-old",
    });
    await provisioner.destroy(decommissioned.id);
    await prisma.worker.create({
      data: {
        name: "fake-worker",
        tailscaleHostname: "fake-worker",
        tailscaleIp: "100.64.8.8",
        provider: "fake",
        providerVmId: "fake-1",
        region: "fsn1",
        capacity: 1,
        status: "READY",
      },
    });

    const owned = await provisioner.listOwned();

    expect(owned.map((worker) => worker.id)).toEqual([active.id]);
    expect(owned[0].provider).toBe("hetzner");
  });

  it("createHetznerWorkerProvisionerFromEnv validates required env values", () => {
    expect(() => createHetznerWorkerProvisionerFromEnv({})).toThrow(
      "Hetzner provisioner requires env HETZNER_API_TOKEN",
    );
    const provisioner = createHetznerWorkerProvisionerFromEnv({
      HETZNER_API_TOKEN: "hcloud-token",
      TAILSCALE_API_KEY: "tailscale-key",
      TAILSCALE_TAILNET: "example.com",
      WORKER_AGENT_IMAGE: "worker-agent:test",
      WORKER_AGENT_HMAC_SECRET: "agent-secret",
      APP_BASE_URL: "https://app.example.com",
      SANDBOX_IMAGE: "sandbox:test",
      WATCHTOWER_HTTP_API_TOKEN: "watchtower-token",
    });

    expect(provisioner.providerId).toBe("hetzner");
  });
});
