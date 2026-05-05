import { prisma } from "@/lib/db/client";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import type { AgentClient } from "@/lib/runtime/worker-pool/types";

interface ProjectAgentTarget {
  sandboxId: string;
  client: AgentClient;
}

function workerAgentSecret(): string {
  const value = process.env.WORKER_AGENT_HMAC_SECRET;
  if (!value) {
    throw new Error("WORKER_AGENT_HMAC_SECRET is not set");
  }
  return value;
}

async function agentClientForProject(
  projectId: string,
): Promise<ProjectAgentTarget | null> {
  const sandbox = await prisma.workerSandbox.findUnique({
    where: { projectId },
    select: {
      id: true,
      worker: {
        select: {
          tailscaleIp: true,
        },
      },
    },
  });

  if (!sandbox) {
    return null;
  }

  return {
    sandboxId: sandbox.id,
    client: createAgentClient({
      baseUrl: `http://${sandbox.worker.tailscaleIp}:4500`,
      hmacSecret: workerAgentSecret(),
    }),
  };
}

export async function requestProjectQueueDrain(
  projectId: string,
): Promise<void> {
  const target = await agentClientForProject(projectId);
  if (!target) {
    return;
  }
  await target.client.drainProjectQueue(target.sandboxId, projectId);
}

export async function requestProjectRunCancel(
  projectId: string,
  runId: string,
): Promise<void> {
  const target = await agentClientForProject(projectId);
  if (!target) {
    return;
  }
  await target.client.cancelProjectRun(target.sandboxId, projectId, runId);
}
