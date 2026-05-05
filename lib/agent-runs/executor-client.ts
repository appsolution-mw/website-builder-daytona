import { prisma } from "@/lib/db/client";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import { resolveWorkerAgentClientConfig } from "@/lib/runtime/worker-pool";
import type { AgentClient } from "@/lib/runtime/worker-pool/types";

interface ProjectAgentTarget {
  sandboxId: string;
  client: AgentClient;
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
    client: createAgentClient(resolveWorkerAgentClientConfig({
      worker: sandbox.worker,
    })),
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
