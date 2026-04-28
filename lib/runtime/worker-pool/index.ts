import { createSimpleScheduler } from "../scheduler/simple";
import { createFakeProvisioner } from "../provisioner/fake";
import { createAgentClient } from "./agent-client";
import { createWorkerPoolRuntime } from "./runtime";
import type { Runtime, WorkerRecord } from "../types";
import type { AgentClient } from "./types";

export interface CreateLocalWorkerPoolRuntimeArgs {
  sandboxImage?: string;
  hmacSecret?: string;
}

/**
 * Convenience factory for `RUNTIME_MODE=worker-pool-local`. Wires:
 *   - SimpleScheduler  (DB-backed)
 *   - FakeProvisioner  (in-memory)
 *   - HTTP AgentClient against worker.tailscaleIp:4500
 *   - brokerEnv passes through agent credentials so the in-container broker
 *     can authenticate the chosen agent runtime (claude-code / codex / etc.)
 */
export function createLocalWorkerPoolRuntime(args: CreateLocalWorkerPoolRuntimeArgs = {}): Runtime {
  const sandboxImage = args.sandboxImage ?? required("SANDBOX_IMAGE");
  const hmacSecret = args.hmacSecret ?? required("WORKER_AGENT_HMAC_SECRET");
  const scheduler = createSimpleScheduler();
  const provisioner = createFakeProvisioner();
  const agentClientFor = (w: WorkerRecord): AgentClient =>
    createAgentClient({ baseUrl: `http://${w.tailscaleIp}:4500`, hmacSecret });
  return createWorkerPoolRuntime({
    scheduler,
    provisioner,
    agentClientFor,
    sandboxImage,
    brokerEnv: () => {
      const env: Record<string, string> = {};
      const passthrough = [
        "AGENT_RUNTIME",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "OPENAI_API_KEY",
        "GITHUB_CLONE_TOKEN",
        "GITHUB_REPO_OWNER",
        "GITHUB_REPO_NAME",
      ];
      for (const k of passthrough) {
        const v = process.env[k];
        if (v) env[k] = v;
      }
      return env;
    },
  });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`worker-pool runtime requires env: ${name}`);
  return v;
}

export { createWorkerPoolRuntime } from "./runtime";
export { createAgentClient } from "./agent-client";
export { createFakeAgentClient } from "./fake-agent-client";
export type * from "./types";
