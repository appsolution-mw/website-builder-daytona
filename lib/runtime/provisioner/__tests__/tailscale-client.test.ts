import { describe, expect, it, vi } from "vitest";
import { createTailscaleClient } from "../tailscale-client";

describe("createTailscaleClient", () => {
  it("createAuthKey posts key capabilities and returns the auth key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ key: "tskey-auth-123" }), { status: 200 }),
    );
    const client = createTailscaleClient({
      apiKey: "tailscale-key",
      tailnet: "example.com",
      fetchImpl: fetchMock,
    });

    const key = await client.createAuthKey({
      description: "worker wbd-worker-a",
      tags: ["tag:wbd-worker"],
      reusable: false,
      expirySeconds: 900,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tailscale.com/api/v2/tailnet/example.com/keys",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      description: "worker wbd-worker-a",
      expirySeconds: 900,
      capabilities: {
        devices: {
          create: {
            reusable: false,
            ephemeral: false,
            tags: ["tag:wbd-worker"],
          },
        },
      },
    });
    expect(key).toBe("tskey-auth-123");
  });

  it("findDeviceIpByHostname returns the first Tailscale IPv4 address", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        devices: [
          {
            hostname: "other-worker",
            addresses: ["100.64.1.19"],
          },
          {
            hostname: "wbd-worker-a",
            addresses: ["fd7a:115c:a1e0::1", "100.64.1.20"],
          },
        ],
      }), { status: 200 }),
    );
    const client = createTailscaleClient({
      apiKey: "tailscale-key",
      tailnet: "example.com",
      fetchImpl: fetchMock,
    });

    await expect(client.findDeviceIpByHostname("wbd-worker-a")).resolves.toBe("100.64.1.20");
  });
});
