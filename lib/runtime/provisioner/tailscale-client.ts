const TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2/tailnet";

export interface TailscaleClient {
  createAuthKey(args: {
    description: string;
    tags: string[];
    reusable: boolean;
    expirySeconds: number;
  }): Promise<TailscaleAuthKey>;
  deleteAuthKey(keyId: string): Promise<void>;
  findDeviceIpByHostname(hostname: string): Promise<string | null>;
}

export interface TailscaleAuthKey {
  id: string | null;
  key: string;
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
    async createAuthKey(keyArgs): Promise<TailscaleAuthKey> {
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
        throw new Error(`Tailscale createAuthKey failed with HTTP ${response.status}: ${await readBodySafe(response)}`);
      }

      const parsed = await readJson<TailscaleAuthKeyResponse>(response);
      return { id: parsed.id ?? null, key: parsed.key };
    },
    async deleteAuthKey(keyId): Promise<void> {
      const response = await fetchFn(`${baseUrl}/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
        headers,
      });

      if (response.ok || response.status === 404) return;

      throw new Error(`Tailscale deleteAuthKey failed with HTTP ${response.status}: ${await readBodySafe(response)}`);
    },
    async findDeviceIpByHostname(hostname): Promise<string | null> {
      const response = await fetchFn(`${baseUrl}/devices`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(`Tailscale findDeviceIpByHostname failed with HTTP ${response.status}: ${await readBodySafe(response)}`);
      }

      const parsed = await readJson<TailscaleDevicesResponse>(response);
      const device = parsed.devices.find((candidate) => candidate.hostname === hostname);
      return device?.addresses.find((address) => address.startsWith("100.")) ?? null;
    },
  };
}

interface TailscaleAuthKeyResponse {
  id?: string | null;
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

async function readBodySafe(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 0 ? text.slice(0, 500) : "(empty body)";
  } catch {
    return "(unreadable body)";
  }
}
