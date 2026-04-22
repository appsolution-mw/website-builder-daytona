import { Daytona, SandboxState } from "@daytona/sdk";
import type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";

const BROKER_PORT = 4000;
const PREVIEW_PORT = 3000;
const BASE_IMAGE = "node:24-alpine";
const BOOT_TIMEOUT_SEC = 120;

function getDaytona(): Daytona {
  const apiKey = process.env.DAYTONA_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api";
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
  return new Daytona({ apiKey, apiUrl });
}

/**
 * Build the one-liner shell command that the host runs inside the sandbox
 * AFTER create returns. This command:
 *   1. installs git + pnpm (alpine needs git; corepack ships with node:24-alpine)
 *   2. clones the private monorepo using the caller-provided PAT
 *   3. cd's into the repo
 *   4. invokes the committed entrypoint.sh, which installs deps and starts both
 *      broker and next dev
 *
 * The command is passed verbatim to sandbox.process.executeCommand.
 * We background the whole thing with `nohup ... &` so executeCommand returns
 * promptly — the broker/next processes continue running inside the sandbox.
 */
function buildBootCommand(args: {
  projectId: string;
  cloneToken: string;
  repoOwner: string;
  repoName: string;
  branch: string;
}): string {
  const { projectId, cloneToken, repoOwner, repoName, branch } = args;
  // Single-quote-safe: neither token nor repo names nor branch can contain
  // single quotes (tokens alnum+underscore+dash; owner/repo/branch per
  // GitHub/Git ref-format constraints).
  return [
    `apk add --no-cache git`,
    `corepack enable pnpm`,
    `mkdir -p /workspace`,
    `cd /workspace`,
    `git clone --depth=1 -b '${branch}' "https://x-access-token:${cloneToken}@github.com/${repoOwner}/${repoName}.git" repo`,
    `cd repo`,
    `PROJECT_ID='${projectId}' BROKER_PORT=${BROKER_PORT} PREVIEW_PORT=${PREVIEW_PORT} nohup sh container/entrypoint.sh > /workspace/entrypoint.log 2>&1 &`,
    // Give the entrypoint a moment to get going before returning
    `sleep 3`,
  ].join(" && ");
}

function mapState(state: unknown): SandboxStatus {
  switch (state) {
    case SandboxState.STARTED:
    case "started":
      return "running";
    case SandboxState.STOPPED:
    case "stopped":
      return "stopped";
    case SandboxState.DESTROYED:
    case "destroyed":
      return "destroyed";
    case "starting":
    case "creating":
    case "pulling_snapshot":
      return "provisioning";
    default:
      return "error";
  }
}

export function createCloudClient(): DaytonaClient {
  const daytona = getDaytona();

  return {
    async spawnProjectSandbox({
      projectId,
      cloneToken,
      repoOwner,
      repoName,
    }): Promise<SandboxInfo> {
      // create() blocks until the sandbox is started (default 60s timeout).
      const sandbox = await daytona.create({
        image: BASE_IMAGE,
        resources: { cpu: 2, memory: 4, disk: 10 },
        public: true, // preview URLs are unauthenticated
        envVars: {
          PROJECT_ID: projectId,
        },
      });

      // Run the boot script. nohup+& means this returns as soon as the clone
      // + backgrounding + sleep 3 finishes — the entrypoint continues running.
      const branch = process.env.GITHUB_CLONE_BRANCH ?? "main";
      await sandbox.process.executeCommand(
        buildBootCommand({ projectId, cloneToken, repoOwner, repoName, branch }),
        undefined,
        undefined,
        BOOT_TIMEOUT_SEC,
      );

      // Both ports return public URLs because of `public: true`.
      const brokerPreview = await sandbox.getPreviewLink(BROKER_PORT);
      const appPreview = await sandbox.getPreviewLink(PREVIEW_PORT);

      return {
        sandboxId: sandbox.id,
        // Preview URLs come back as https://...; ws-proxy talks to broker over WSS.
        brokerUrl: brokerPreview.url.replace(/^https:\/\//, "wss://"),
        brokerPreviewToken: brokerPreview.token ?? "",
        previewUrl: appPreview.url,
      };
    },

    async destroyProjectSandbox(sandboxId: string): Promise<void> {
      try {
        const sandbox = await daytona.get(sandboxId);
        await sandbox.delete();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Idempotent — swallow not-found errors
        if (!/not found|does not exist/i.test(msg)) throw err;
      }
    },

    async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
      try {
        const sandbox = await daytona.get(sandboxId);
        // The SDK exposes sandbox.state — cross-check with DAYTONA_SDK_NOTES.md
        // for the exact accessor. Fall back to reading off the instance.
        const state = (sandbox as unknown as { state?: unknown }).state;
        return mapState(state);
      } catch {
        return "destroyed";
      }
    },
  };
}
