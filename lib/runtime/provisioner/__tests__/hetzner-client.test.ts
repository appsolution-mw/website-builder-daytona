import { describe, expect, it, vi } from "vitest";
import { createHetznerClient } from "../hetzner-client";

describe("createHetznerClient", () => {
  it("createServer posts the server request and returns server network details", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        server: {
          id: 123,
          name: "wbd-worker-a",
          public_net: {
            ipv4: {
              ip: "203.0.113.10",
            },
          },
        },
      }), { status: 201 }),
    );
    const client = createHetznerClient("hcloud-token", fetchMock);

    const server = await client.createServer({
      name: "wbd-worker-a",
      serverType: "ccx33",
      image: "ubuntu-24.04",
      location: "fsn1",
      userData: "#cloud-config",
      labels: { app: "website-builder-daytona" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.hetzner.cloud/v1/servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer hcloud-token",
          "content-type": "application/json",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      name: "wbd-worker-a",
      server_type: "ccx33",
      image: "ubuntu-24.04",
      location: "fsn1",
      user_data: "#cloud-config",
      labels: { app: "website-builder-daytona" },
    });
    expect(server).toEqual({
      id: "123",
      name: "wbd-worker-a",
      publicIpv4: "203.0.113.10",
    });
  });

  it("deleteServer treats a missing server as already deleted", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const client = createHetznerClient("hcloud-token", fetchMock);

    await expect(client.deleteServer("123")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.hetzner.cloud/v1/servers/123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
