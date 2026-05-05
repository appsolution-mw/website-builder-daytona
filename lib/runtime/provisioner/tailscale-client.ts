const TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2/tailnet";

export interface TailscaleClient {
  createAuthKey(args: {
    description: string;
    tags: string[];
    reusable: boolean;
    expirySeconds: number;
  }): Promise<string>;
  findDeviceIpByHostname(hostname: string): Promise<string | null>;
}

export function createTailscaleClient(args: {
  apiKey: string;
  tailnet: string;
  fetchImpl?: typeof fetch;
}): TailscaleClient {
  const fetchFn = args.fetchImpl ?? fetch;
  const baseUrl = `${TAILSCALE_API_BASE}/${encodeURIComponent(args.tailnet)}`;
  const headers = {
    authorization: `Bearer ${args.apiKey}`,
    "content-type": "application/json",
  };

  return {
    async createAuthKey(keyArgs): Promise<string> {
      const response = await fetchFn(`${baseUrl}/keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          description: keyArgs.description,
          expirySeconds: keyArgs.expirySeconds,
          capabilities: {
            devices: {
              create: {
                reusable: keyArgs.reusable,
                ephemeral: false,
                tags: keyArgs.tags,
              },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Tailscale createAuthKey failed with HTTP ${response.status}`);
      }

      const parsed = await readJson<TailscaleAuthKeyResponse>(response);
      return parsed.key;
    },
    async findDeviceIpByHostname(hostname): Promise<string | null> {
      const response = await fetchFn(`${baseUrl}/devices`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(`Tailscale findDeviceIpByHostname failed with HTTP ${response.status}`);
      }

      const parsed = await readJson<TailscaleDevicesResponse>(response);
      const device = parsed.devices.find((candidate) => candidate.hostname === hostname);
      return device?.addresses.find((address) => address.startsWith("100.")) ?? null;
    },
  };
}

interface TailscaleAuthKeyResponse {
  key: string;
}

interface TailscaleDevicesResponse {
  devices: Array<{
    hostname: string;
    addresses: string[];
  }>;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
