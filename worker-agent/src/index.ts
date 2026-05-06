import Docker from "dockerode";
import { buildServer } from "./server.js";
import { createDockerClient } from "./docker.js";
import { startHeartbeat } from "./heartbeat.js";

const PORT = Number(process.env.PORT ?? 4500);
const HMAC_SECRET = required("HMAC_SECRET");
const HOST_URL = required("HOST_URL");
const WORKER_ID = required("WORKER_ID");
const BROKER_HOST = process.env.BROKER_HOST?.trim() || "127.0.0.1";
const PORT_RANGE_MIN = Number(process.env.SANDBOX_PORT_MIN ?? 30000);
const PORT_RANGE_MAX = Number(process.env.SANDBOX_PORT_MAX ?? 39999);

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[worker-agent] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const docker = new Docker();
  const dockerVersion = (await docker.version()).Version;

  // Pre-pull the sandbox image if SANDBOX_IMAGE is set and not already
  // present locally — so /health signals readiness only after the image
  // is on disk. A locally-built `wbd/*` tag has no upstream registry, so
  // we skip the pull whenever inspect succeeds.
  const image = process.env.SANDBOX_IMAGE;
  if (image) {
    let alreadyLocal = false;
    try {
      await docker.getImage(image).inspect();
      alreadyLocal = true;
      console.log(`[worker-agent] sandbox image present locally: ${image}`);
    } catch {
      // Not present — fall through to pull.
    }
    if (!alreadyLocal) {
      console.log(`[worker-agent] pre-pulling ${image}…`);
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
        });
      });
      console.log(`[worker-agent] pre-pull done`);
    }
  }

  const dockerClient = createDockerClient({
    docker,
    portRange: { min: PORT_RANGE_MIN, max: PORT_RANGE_MAX },
  });

  const app = await buildServer({
    docker: dockerClient,
    hmacSecret: HMAC_SECRET,
    brokerContainerPort: 4000,
    previewContainerPort: 3000,
    brokerHost: BROKER_HOST,
    dockerVersion,
  });
  await app.listen({ host: "0.0.0.0", port: PORT });
  console.log(`[worker-agent] listening on :${PORT}`);

  // Refresh running-count every 5s so heartbeat samples have a real number.
  let runningCount = 0;
  setInterval(async () => {
    try {
      const list = await dockerClient.listSandboxes();
      runningCount = list.filter((s) => s.status === "running").length;
    } catch { /* swallow — heartbeat just sends stale value */ }
  }, 5_000).unref();

  const stopHeartbeat = startHeartbeat({
    hostUrl: HOST_URL,
    workerId: WORKER_ID,
    hmacSecret: HMAC_SECRET,
    sample: () => ({
      runningSandboxes: runningCount,
      dockerVersion,
      uptime: Math.floor(process.uptime()),
    }),
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      console.log(`[worker-agent] received ${sig}, shutting down…`);
      stopHeartbeat();
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[worker-agent] fatal:", err);
  process.exit(1);
});
