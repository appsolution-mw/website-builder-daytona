#!/usr/bin/env tsx
/**
 * Bootstrap a Hetzner edge server running Tailscale + Caddy (Cloudflare DNS).
 *
 * Reads the required tokens from .env, creates a Tailscale auth key, spawns a
 * Hetzner CX22 with cloud-init that installs Tailscale and Caddy with the
 * Cloudflare DNS plugin, waits for the device to appear in the tailnet, sets
 * the wildcard DNS record at Cloudflare, and appends CADDY_ADMIN_URL to .env.
 *
 * Usage:
 *   pnpm tsx scripts/setup-hetzner-edge.ts
 *
 * Idempotency:
 *   - Cloudflare wildcard record is created or updated in place.
 *   - The Hetzner server is NOT recreated if it already exists (script aborts
 *     with a hint instead, to avoid surprise duplicate billing).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { createHetznerClient } from "../lib/runtime/provisioner/hetzner-client";
import { createTailscaleClient, type TailscaleClient } from "../lib/runtime/provisioner/tailscale-client";

const ENV_PATH = resolve(process.cwd(), ".env");
if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const SERVER_NAME = "wbd-edge";
const SERVER_TYPE = "cx23";
const SERVER_LOCATION = "fsn1";
const SERVER_IMAGE = "ubuntu-24.04";
const TAILSCALE_TAG = "tag:wbd-edge";
const AUTH_KEY_EXPIRY_S = 60 * 60 * 24 * 90;
const TAILSCALE_WAIT_TIMEOUT_MS = 5 * 60_000;
const TAILSCALE_POLL_INTERVAL_MS = 5_000;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name} in .env`);
  }
  return value.trim();
}

function readPublicSshKey(): string {
  for (const file of ["id_ed25519.pub", "id_rsa.pub"]) {
    const path = resolve(homedir(), ".ssh", file);
    if (existsSync(path)) {
      return readFileSync(path, "utf8").trim();
    }
  }
  throw new Error("No SSH public key found in ~/.ssh (tried id_ed25519.pub, id_rsa.pub)");
}

function renderCloudInit(args: {
  cloudflareToken: string;
  tailscaleAuthKey: string;
  sshAuthorizedKey: string;
}): string {
  return [
    "#cloud-config",
    "package_update: true",
    "package_upgrade: true",
    "packages:",
    "  - curl",
    "  - ca-certificates",
    "  - ufw",
    "ssh_authorized_keys:",
    `  - ${args.sshAuthorizedKey}`,
    "write_files:",
    "  - path: /etc/caddy/Caddyfile",
    "    content: |",
    "      {",
    "        admin :2019 {",
    "          origins TAILSCALE_IP:2019",
    "        }",
    "        acme_dns cloudflare {env.CLOUDFLARE_API_TOKEN}",
    "      }",
    "  - path: /etc/systemd/system/caddy.service",
    "    content: |",
    "      [Unit]",
    "      Description=Caddy edge",
    "      After=network-online.target tailscaled.service",
    "      Wants=network-online.target tailscaled.service",
    "      [Service]",
    `      Environment=CLOUDFLARE_API_TOKEN=${args.cloudflareToken}`,
    "      ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
    "      ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile",
    "      Restart=on-failure",
    "      [Install]",
    "      WantedBy=multi-user.target",
    "runcmd:",
    "  - curl -fsSL \"https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com%2Fcaddy-dns%2Fcloudflare\" -o /usr/bin/caddy",
    "  - chmod +x /usr/bin/caddy",
    "  - curl -fsSL https://tailscale.com/install.sh | sh",
    `  - tailscale up --auth-key=${args.tailscaleAuthKey} --hostname=${SERVER_NAME} --advertise-tags=${TAILSCALE_TAG} --ssh`,
    `  - bash -c 'TS_IP=$(tailscale ip -4 | head -1) && sed -i "s|origins TAILSCALE_IP|origins $TS_IP|" /etc/caddy/Caddyfile'`,
    "  - ufw default deny incoming",
    "  - ufw default allow outgoing",
    "  - ufw allow 22/tcp",
    "  - ufw allow 80/tcp",
    "  - ufw allow 443/tcp",
    "  - ufw allow in on tailscale0",
    "  - ufw --force enable",
    "  - systemctl daemon-reload",
    "  - systemctl enable --now caddy",
  ].join("\n");
}

async function findExistingHetznerServer(args: { apiToken: string; name: string }): Promise<{ id: string; publicIpv4: string | null } | null> {
  const res = await fetch(`https://api.hetzner.cloud/v1/servers?name=${encodeURIComponent(args.name)}`, {
    headers: { authorization: `Bearer ${args.apiToken}` },
  });
  if (!res.ok) throw new Error(`Hetzner servers lookup failed HTTP ${res.status}`);
  const json = (await res.json()) as { servers: Array<{ id: number | string; public_net?: { ipv4?: { ip?: string | null } | null } | null }> };
  const server = json.servers[0];
  if (!server) return null;
  return {
    id: String(server.id),
    publicIpv4: server.public_net?.ipv4?.ip ?? null,
  };
}

async function ensureCloudflareWildcard(args: {
  apiToken: string;
  zoneName: string;
  edgePublicIp: string;
}): Promise<void> {
  const headers = {
    authorization: `Bearer ${args.apiToken}`,
    "content-type": "application/json",
  };

  const zonesRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(args.zoneName)}`,
    { headers },
  );
  if (!zonesRes.ok) throw new Error(`Cloudflare zones lookup failed HTTP ${zonesRes.status}`);
  const zones = (await zonesRes.json()) as { result: Array<{ id: string }> };
  const zone = zones.result[0];
  if (!zone) throw new Error(`Cloudflare zone ${args.zoneName} not found for token`);

  const recordName = `*.${args.zoneName}`;
  const existingRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(recordName)}`,
    { headers },
  );
  if (!existingRes.ok) throw new Error(`Cloudflare DNS lookup failed HTTP ${existingRes.status}`);
  const existing = (await existingRes.json()) as { result: Array<{ id: string }> };

  const body = JSON.stringify({
    type: "A",
    name: recordName,
    content: args.edgePublicIp,
    ttl: 60,
    proxied: false,
  });

  if (existing.result[0]) {
    const update = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records/${existing.result[0].id}`,
      { method: "PUT", headers, body },
    );
    if (!update.ok) throw new Error(`Cloudflare DNS update failed HTTP ${update.status}: ${await update.text()}`);
    console.log(`✓ Cloudflare DNS ${recordName} updated → ${args.edgePublicIp}`);
  } else {
    const create = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`,
      { method: "POST", headers, body },
    );
    if (!create.ok) throw new Error(`Cloudflare DNS create failed HTTP ${create.status}: ${await create.text()}`);
    console.log(`✓ Cloudflare DNS ${recordName} created → ${args.edgePublicIp}`);
  }
}

async function waitForTailscaleDevice(args: {
  client: TailscaleClient;
  hostname: string;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ip = await args.client.findDeviceIpByHostname(args.hostname);
      if (ip) return ip;
    } catch (err) {
      console.warn(`  (tailscale poll error: ${(err as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, TAILSCALE_POLL_INTERVAL_MS));
  }
  throw new Error(`Tailscale device "${args.hostname}" did not appear within ${args.timeoutMs / 1000}s`);
}

function appendEnvLineIfMissing(name: string, value: string): void {
  const current = readFileSync(ENV_PATH, "utf8");
  const lineRegex = new RegExp(`^${name}=`, "m");
  if (lineRegex.test(current)) {
    console.log(`ℹ ${name} already in .env — leaving as-is`);
    return;
  }
  const trailingNewline = current.endsWith("\n") ? "" : "\n";
  appendFileSync(ENV_PATH, `${trailingNewline}${name}=${value}\n`);
  console.log(`✓ ${name} appended to .env`);
}

async function main(): Promise<void> {
  const hetznerToken = required("HETZNER_API_TOKEN");
  const cloudflareToken = required("CLOUDFLARE_API_TOKEN");
  const tailscaleApiKey = required("TAILSCALE_API_KEY");
  const tailscaleTailnet = required("TAILSCALE_TAILNET");
  const publicBaseDomain = required("PUBLIC_BASE_DOMAIN");
  const sshKey = readPublicSshKey();

  const tailscale = createTailscaleClient({
    apiKey: tailscaleApiKey,
    tailnet: tailscaleTailnet,
  });
  const hetzner = createHetznerClient(hetznerToken);

  console.log(`▶ Checking for existing Hetzner server "${SERVER_NAME}"…`);
  const existingServer = await findExistingHetznerServer({ apiToken: hetznerToken, name: SERVER_NAME });
  let publicIpv4: string | null;

  if (existingServer) {
    console.log(`  found existing server id=${existingServer.id} ip=${existingServer.publicIpv4 ?? "(pending)"}`);
    console.log("  skipping creation — delete it in the Hetzner console first if you want a clean run.");
    publicIpv4 = existingServer.publicIpv4;
  } else {
    console.log(`▶ Creating Tailscale auth key (tag ${TAILSCALE_TAG})…`);
    const authKey = await tailscale.createAuthKey({
      description: `${SERVER_NAME} bootstrap ${new Date().toISOString().slice(0, 10)}`,
      tags: [TAILSCALE_TAG],
      reusable: false,
      expirySeconds: AUTH_KEY_EXPIRY_S,
    });
    console.log(`  auth key id: ${authKey.id ?? "(unknown)"}`);

    const userData = renderCloudInit({
      cloudflareToken,
      tailscaleAuthKey: authKey.key,
      sshAuthorizedKey: sshKey,
    });

    console.log(`▶ Creating Hetzner server ${SERVER_NAME} (${SERVER_TYPE} @ ${SERVER_LOCATION})…`);
    const server = await hetzner.createServer({
      name: SERVER_NAME,
      serverType: SERVER_TYPE,
      image: SERVER_IMAGE,
      location: SERVER_LOCATION,
      userData,
      labels: { role: "edge", project: "wbd" },
    });
    console.log(`  server id: ${server.id}`);
    console.log(`  public IPv4: ${server.publicIpv4 ?? "(pending)"}`);
    publicIpv4 = server.publicIpv4;
  }

  if (!publicIpv4) {
    throw new Error("No public IPv4 returned by Hetzner — check the Hetzner console.");
  }

  console.log("▶ Waiting for Tailscale device to come online (up to 5 min)…");
  const tailscaleIp = await waitForTailscaleDevice({
    client: tailscale,
    hostname: SERVER_NAME,
    timeoutMs: TAILSCALE_WAIT_TIMEOUT_MS,
  });
  console.log(`  tailscale IP: ${tailscaleIp}`);

  console.log("▶ Setting Cloudflare wildcard DNS…");
  await ensureCloudflareWildcard({
    apiToken: cloudflareToken,
    zoneName: publicBaseDomain,
    edgePublicIp: publicIpv4,
  });

  console.log("▶ Updating .env…");
  appendEnvLineIfMissing("CADDY_ADMIN_URL", `http://${tailscaleIp}:2019`);
  appendEnvLineIfMissing("APP_BASE_URL", "http://localhost:3000");

  console.log("");
  console.log("=== Done ===");
  console.log(`Edge server:   ${SERVER_NAME}`);
  console.log(`  public IPv4: ${publicIpv4}`);
  console.log(`  tailscale:   ${tailscaleIp}`);
  console.log(`Cloudflare:    *.${publicBaseDomain} → ${publicIpv4}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Install Tailscale on this machine and join the tailnet (so the app can reach Caddy admin).");
  console.log("  2. Build and push WORKER_AGENT_IMAGE and SANDBOX_IMAGE to a public registry.");
  console.log("  3. Set RUNTIME_MODE=worker-pool-hetzner and restart pnpm dev.");
  console.log("  4. Open /admin/workers and create the first worker.");
}

main().then(() => process.exit(0), (err) => {
  console.error("✗ Bootstrap failed:");
  console.error(err);
  process.exit(1);
});
