import Docker from "dockerode";
import { buildServer } from "./server.js";
import { createDockerClient } from "./docker.js";
import { startHeartbeat } from "./heartbeat.js";
import { watchBrokerReadiness } from "./broker-ready.js";

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

  // Pre-pull the sandbox image so /health signals readiness only after the
  // image is on disk. Locally-built `wbd/*` tags have no upstream registry,
  // so we skip the pull when present locally. For registry-backed tags
  // (e.g. ghcr.io/...) we ALWAYS attempt a pull on boot — that way restarting
  // the worker-agent (Watchtower or manual) is enough to pick up new sandbox
  // image releases. Pull failures are non-fatal: a stale-but-cached image
  // beats a non-bootable worker.
  const image = process.env.SANDBOX_IMAGE;
  if (image) {
    const isLocalOnly = image.startsWith("wbd/");
    let presentLocally = false;
    try {
      await docker.getImage(image).inspect();
      presentLocally = true;
    } catch {
      // not present
    }
    const shouldPull = !isLocalOnly || !presentLocally;
    if (shouldPull) {
      console.log(`[worker-agent] pulling ${image}…`);
      try {
        await new Promise<void>((resolve, reject) => {
          docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
          });
        });
        console.log(`[worker-agent] pull done`);
      } catch (err) {
        if (presentLocally) {
          console.warn(`[worker-agent] pull failed, continuing with cached image:`, err);
        } else {
          throw err;
        }
      }
    } else {
      console.log(`[worker-agent] sandbox image present locally (local-only tag): ${image}`);
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
    hostUrl: HOST_URL,
  });
  await app.listen({ host: "0.0.0.0", port: PORT });
  console.log(`[worker-agent] listening on :${PORT}`);

  // Self-heal: probe every already-running sandbox once and report broker
  // readiness back to the host. Covers two cases:
  //  - Worker-agent restarted while sandboxes kept running.
  //  - Project rows existed before the brokerReady flag and the host doesn't
  //    yet know they are reachable.
  try {
    const existing = await dockerClient.listSandboxes();
    for (const sandbox of existing) {
      if (sandbox.status !== "running") continue;
      if (typeof sandbox.brokerPort !== "number") continue;
      watchBrokerReadiness({
        sandboxId: sandbox.sandboxId,
        brokerHost: BROKER_HOST,
        brokerPort: sandbox.brokerPort,
        hostUrl: HOST_URL,
        hmacSecret: HMAC_SECRET,
      });
    }
    if (existing.length > 0) {
      console.log(`[worker-agent] readiness re-probe scheduled for ${existing.length} existing sandbox(es)`);
    }
  } catch (err) {
    console.warn("[worker-agent] failed to enumerate existing sandboxes for readiness re-probe:", err);
  }

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
