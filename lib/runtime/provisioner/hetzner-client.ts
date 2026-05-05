const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

export interface HetznerClient {
  createServer(args: {
    name: string;
    serverType: string;
    image: string;
    location: string;
    userData: string;
    labels: Record<string, string>;
  }): Promise<{ id: string; name: string; publicIpv4: string | null }>;
  deleteServer(serverId: string): Promise<void>;
}

interface HetznerServerResponse {
  server: {
    id: number | string;
    name: string;
    public_net?: {
      ipv4?: {
        ip?: string | null;
      } | null;
    } | null;
  };
}

export function createHetznerClient(
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): HetznerClient {
  const headers = {
    authorization: `Bearer ${apiToken}`,
    "content-type": "application/json",
  };

  return {
    async createServer(args): Promise<{ id: string; name: string; publicIpv4: string | null }> {
      const response = await fetchImpl(`${HETZNER_API_BASE}/servers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: args.name,
          server_type: args.serverType,
          image: args.image,
          location: args.location,
          user_data: args.userData,
          labels: args.labels,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hetzner createServer failed with HTTP ${response.status}`);
      }

      const parsed = await readJson<HetznerServerResponse>(response);
      return {
        id: String(parsed.server.id),
        name: parsed.server.name,
        publicIpv4: parsed.server.public_net?.ipv4?.ip ?? null,
      };
    },
    async deleteServer(serverId): Promise<void> {
      const response = await fetchImpl(
        `${HETZNER_API_BASE}/servers/${encodeURIComponent(serverId)}`,
        {
          method: "DELETE",
          headers,
        },
      );

      if (response.ok || response.status === 404) return;

      throw new Error(`Hetzner deleteServer failed with HTTP ${response.status}`);
    },
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
