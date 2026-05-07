/**
 * Bootstrap Watchtower auto-update on legacy Hetzner workers.
 *
 * For each non-decommissioned `hetzner` Worker in the database, this script
 *   1. installs Watchtower (Nicholas-Fedor fork) with the host's docker auth
 *      mounted, if not already running with that image,
 *   2. recreates the `worker-agent` container so it carries the
 *      `com.centurylinklabs.watchtower.enable=true` label and the
 *      `IMAGE_REGISTRY_*` env vars needed for private GHCR sandbox pulls.
 *
 * Idempotent: workers that already match the desired state are skipped.
 *
 * Required env (from `.env`):
 *   WATCHTOWER_HTTP_API_TOKEN
 *   IMAGE_REGISTRY_HOST          (e.g. ghcr.io)
 *   IMAGE_REGISTRY_USERNAME
 *   IMAGE_REGISTRY_TOKEN
 *
 * SSH: connects via the worker's stored `tailscaleIp`. Run this from a host
 * that's joined the Tailnet (your Mac, the edge VM, …) so the IPs resolve.
 *
 * Usage:
 *   pnpm tsx scripts/bootstrap-watchtower.ts
 *   pnpm tsx scripts/bootstrap-watchtower.ts --only worker-4
 *   pnpm tsx scripts/bootstrap-watchtower.ts --dry-run
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env BEFORE importing the prisma client — it reads DATABASE_URL at
// module-init time. Same pattern as scripts/setup-hetzner-edge.ts. The
// prisma client is imported dynamically inside `main()` after the .env is
// loaded so import-hoisting can't run it first.
const ENV_PATH = resolve(__dirname, "..", ".env");
if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const WATCHTOWER_IMAGE = "ghcr.io/nicholas-fedor/watchtower:latest";

interface Env {
  watchtowerToken: string;
  registryHost: string;
  registryUsername: string;
  registryToken: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function loadEnv(): Env {
  return {
    watchtowerToken: requireEnv("WATCHTOWER_HTTP_API_TOKEN"),
    registryHost: process.env.IMAGE_REGISTRY_HOST ?? "ghcr.io",
    registryUsername: requireEnv("IMAGE_REGISTRY_USERNAME"),
    registryToken: requireEnv("IMAGE_REGISTRY_TOKEN"),
  };
}

interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run a remote bash script via SSH. The remote env is set via inline
 * env-prefix so we don't depend on AcceptEnv being configured. Tokens are
 * not interpolated into the script body — only into the env line, which is
 * not echoed by the remote shell.
 */
async function runRemote(
  host: string,
  remoteEnv: Record<string, string>,
  script: string,
): Promise<SshResult> {
  return new Promise((resolve) => {
    const envPrefix = Object.entries(remoteEnv)
      .map(([k, v]) => `${k}=${shellQuote(v)}`)
      .join(" ");
    const ssh = spawn(
      "ssh",
      [
        "-o", "ConnectTimeout=15",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "BatchMode=yes",
        `root@${host}`,
        `${envPrefix} bash -s`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    ssh.stdout.on("data", (b) => { stdout += b.toString(); });
    ssh.stderr.on("data", (b) => { stderr += b.toString(); });
    ssh.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
    ssh.stdin.write(script);
    ssh.stdin.end();
  });
}

function shellQuote(value: string): string {
  // Single-quote the value, escaping any embedded single quotes.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const BOOTSTRAP_SCRIPT = `\
set -euo pipefail

echo "  hostname: $(hostname)"

# --- Watchtower -----------------------------------------------------------
WANTED_WT_IMAGE="${WATCHTOWER_IMAGE}"
CURRENT_WT_IMAGE=$(docker inspect watchtower --format '{{.Config.Image}}' 2>/dev/null || echo "")
WT_HAS_AUTH_MOUNT=$(docker inspect watchtower \\
  --format '{{range .Mounts}}{{.Destination}}{{"\\n"}}{{end}}' 2>/dev/null \\
  | grep -cx '/config.json' || true)

if [ "$CURRENT_WT_IMAGE" != "$WANTED_WT_IMAGE" ] || [ "$WT_HAS_AUTH_MOUNT" -eq 0 ]; then
  echo "  watchtower: (re)installing  current=$CURRENT_WT_IMAGE  authMount=$WT_HAS_AUTH_MOUNT"
  if [ ! -f /root/.docker/config.json ]; then
    echo "  watchtower: ERROR /root/.docker/config.json missing — run docker login first" >&2
    exit 1
  fi
  docker pull "$WANTED_WT_IMAGE" >/dev/null
  docker rm -f watchtower >/dev/null 2>&1 || true
  docker run -d --name watchtower --restart unless-stopped \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v /root/.docker/config.json:/config.json:ro \\
    -e DOCKER_CONFIG=/ \\
    -e WATCHTOWER_LABEL_ENABLE=true \\
    -e WATCHTOWER_CLEANUP=true \\
    -e WATCHTOWER_INCLUDE_RESTARTING=true \\
    -e WATCHTOWER_HTTP_API_UPDATE=true \\
    -e WATCHTOWER_HTTP_API_TOKEN="$WATCHTOWER_HTTP_API_TOKEN" \\
    -p 8080:8080 \\
    "$WANTED_WT_IMAGE" >/dev/null
  echo "  watchtower: ✓ installed"
else
  echo "  watchtower: ✓ already current"
fi

# --- worker-agent ---------------------------------------------------------
WA_HAS_LABEL=$(docker inspect worker-agent \\
  --format '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}' 2>/dev/null \\
  | grep -cx 'true' || true)
WA_HAS_REGISTRY_TOKEN=$(docker inspect worker-agent \\
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \\
  | grep -c '^IMAGE_REGISTRY_TOKEN=' || true)

if [ "$WA_HAS_LABEL" -eq 0 ] || [ "$WA_HAS_REGISTRY_TOKEN" -eq 0 ]; then
  echo "  worker-agent: recreating  hasLabel=$WA_HAS_LABEL  hasRegistryToken=$WA_HAS_REGISTRY_TOKEN"
  ENV_LINES=$(docker inspect worker-agent --format '{{range .Config.Env}}{{println .}}{{end}}')
  WORKER_ID=$(echo "$ENV_LINES" | awk -F= '/^WORKER_ID=/{print substr($0,index($0,"=")+1); exit}')
  HMAC_SECRET=$(echo "$ENV_LINES" | awk -F= '/^HMAC_SECRET=/{print substr($0,index($0,"=")+1); exit}')
  HOST_URL=$(echo "$ENV_LINES" | awk -F= '/^HOST_URL=/{print substr($0,index($0,"=")+1); exit}')
  SANDBOX_IMAGE=$(echo "$ENV_LINES" | awk -F= '/^SANDBOX_IMAGE=/{print substr($0,index($0,"=")+1); exit}')
  IMAGE=$(docker inspect worker-agent --format '{{.Config.Image}}')

  if [ -z "$WORKER_ID" ] || [ -z "$HMAC_SECRET" ] || [ -z "$HOST_URL" ] || [ -z "$SANDBOX_IMAGE" ] || [ -z "$IMAGE" ]; then
    echo "  worker-agent: ERROR could not read existing config — refusing to recreate" >&2
    exit 1
  fi

  docker rm -f worker-agent >/dev/null
  docker run -d --name worker-agent --restart unless-stopped \\
    --label com.centurylinklabs.watchtower.enable=true \\
    -p 4500:4500 \\
    --add-host=host.docker.internal:host-gateway \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -e WORKER_ID="$WORKER_ID" \\
    -e HMAC_SECRET="$HMAC_SECRET" \\
    -e HOST_URL="$HOST_URL" \\
    -e SANDBOX_IMAGE="$SANDBOX_IMAGE" \\
    -e BROKER_HOST=host.docker.internal \\
    -e IMAGE_REGISTRY_HOST="$IMAGE_REGISTRY_HOST" \\
    -e IMAGE_REGISTRY_USERNAME="$IMAGE_REGISTRY_USERNAME" \\
    -e IMAGE_REGISTRY_TOKEN="$IMAGE_REGISTRY_TOKEN" \\
    "$IMAGE" >/dev/null
  echo "  worker-agent: ✓ recreated"
else
  echo "  worker-agent: ✓ already configured"
fi
`;

interface Args {
  only: string | null;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { only: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only = argv[i + 1] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  const { prisma } = await import("../lib/db/client");

  const workers = await prisma.worker.findMany({
    where: {
      provider: "hetzner",
      status: { notIn: ["DECOMMISSIONED", "OFFLINE"] },
      ...(args.only ? { name: args.only } : {}),
    },
    select: { id: true, name: true, tailscaleHostname: true, tailscaleIp: true, status: true },
    orderBy: { name: "asc" },
  });

  if (workers.length === 0) {
    console.log(args.only
      ? `No worker named "${args.only}" found in DB.`
      : "No active Hetzner workers found.");
    return;
  }

  console.log(`Bootstrapping Watchtower on ${workers.length} worker(s):`);
  for (const w of workers) console.log(`  - ${w.name} (${w.tailscaleIp || "no-ip"}) status=${w.status}`);
  console.log();

  if (args.dryRun) {
    console.log("--dry-run set, exiting before SSH.");
    return;
  }

  const remoteEnv = {
    WATCHTOWER_HTTP_API_TOKEN: env.watchtowerToken,
    IMAGE_REGISTRY_HOST: env.registryHost,
    IMAGE_REGISTRY_USERNAME: env.registryUsername,
    IMAGE_REGISTRY_TOKEN: env.registryToken,
  };

  const failures: string[] = [];
  for (const worker of workers) {
    const host = worker.tailscaleIp || worker.tailscaleHostname;
    if (!host) {
      console.log(`▶ ${worker.name}: skipped — no tailscaleIp/Hostname in DB`);
      failures.push(worker.name);
      continue;
    }
    console.log(`▶ ${worker.name} (${host})`);
    const result = await runRemote(host, remoteEnv, BOOTSTRAP_SCRIPT);
    if (result.stdout.trim()) console.log(result.stdout.trimEnd().split("\n").map((l) => `  ${l}`).join("\n"));
    if (result.stderr.trim()) console.error(result.stderr.trimEnd().split("\n").map((l) => `  ! ${l}`).join("\n"));
    if (!result.ok) {
      console.error(`  ✗ failed (exit ${result.exitCode})`);
      failures.push(worker.name);
    }
    console.log();
  }

  if (failures.length > 0) {
    console.error(`Done with ${failures.length} failure(s): ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("Done — all workers up to date.");
  }
}

main()
  .catch((err) => {
    console.error("[bootstrap-watchtower] fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../lib/db/client");
    await prisma.$disconnect();
  });
