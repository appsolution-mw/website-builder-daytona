import { prisma } from "@/lib/db/client";
import { dbRuntimeToProtocol } from "@/lib/agents/runtime";
import { prependOpenHandsLibrarySnapshotToPrompt } from "@/lib/agents/openhands-library-snapshot";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import { resolveWorkerAgentClientConfig } from "@/lib/runtime/worker-pool";
import { withTokenRecovery } from "@/lib/runtime/worker-pool/with-token-recovery";
import type { BrokerToHost } from "@wbd/protocol";
import type { AgentClient } from "@/lib/runtime/worker-pool/types";
import { appendRunEvent } from "./events";
import { drainProjectQueue, type RunExecutionAdapter } from "./drain";

interface ProjectAgentTarget {
  sandboxId: string;
  client: AgentClient;
}

const MAX_PROJECT_DRAIN_RUNS = 100;
const activeProjectDrains = new Map<string, Promise<void>>();
const pendingProjectDrains = new Set<string>();

async function agentClientForProject(
  projectId: string,
): Promise<ProjectAgentTarget | null> {
  const sandbox = await prisma.workerSandbox.findFirst({
    where: { projectId, status: { not: "DESTROYED" } },
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
  const active = activeProjectDrains.get(projectId);
  if (active) {
    pendingProjectDrains.add(projectId);
    return active;
  }

  return startProjectDrain(projectId);
}

function startProjectDrain(projectId: string): Promise<void> {
  const drain = drainProjectQueue({
    projectId,
    execute: createRunExecutionAdapter(projectId),
    maxRuns: MAX_PROJECT_DRAIN_RUNS,
  })
    .catch((error: unknown) => {
      console.error("project queue drain failed", error);
    })
    .then(() => undefined)
    .finally(() => {
      activeProjectDrains.delete(projectId);
      if (pendingProjectDrains.delete(projectId)) {
        void startProjectDrain(projectId);
      }
    });

  activeProjectDrains.set(projectId, drain);
  return drain;
}

export async function requestProjectRunCancel(
  projectId: string,
  runId: string,
): Promise<void> {
  const target = await agentClientForProject(projectId);
  if (!target) {
    return;
  }
  await withTokenRecovery(target.client, target.sandboxId, () =>
    target.client.cancelProjectRun(target.sandboxId, projectId, runId),
  );
}

function createRunExecutionAdapter(projectId: string): RunExecutionAdapter {
  return async ({ runId, attemptId }) => {
    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        id: true,
        projectId: true,
        sessionId: true,
        providerSessionId: true,
        runtime: true,
        modelId: true,
        queueSequence: true,
        lastAttemptNumber: true,
        librarySnapshot: { select: { snapshotJson: true } },
        userMessage: {
          select: {
            content: true,
            attachments: {
              orderBy: { position: "asc" },
              select: {
                name: true,
                mimeType: true,
                dataBase64: true,
              },
            },
          },
        },
      },
    });
    if (run.projectId !== projectId) {
      return { ok: false, message: "Run does not belong to project" };
    }

    const target = await agentClientForProject(projectId);
    if (!target) {
      return { ok: false, message: "Project sandbox is not running" };
    }
    const userMessage = run.userMessage;
    if (!userMessage) {
      return { ok: false, message: "Run user message is missing" };
    }

    let sawDone = false;
    let cancelled = false;
    let terminalError: string | null = null;
    const chunks: string[] = [];
    const resumeSession = await shouldResumeRun(run);
    await withTokenRecovery(target.client, target.sandboxId, () =>
      target.client.executeProjectRun(
      target.sandboxId,
      {
        projectId,
        sessionId: run.sessionId,
        providerSessionId: run.providerSessionId,
        runId,
        attemptId,
        prompt: promptForRun({
          prompt: userMessage.content,
          runtime: dbRuntimeToProtocol(run.runtime),
          snapshot: run.librarySnapshot?.snapshotJson,
        }),
        runtime: dbRuntimeToProtocol(run.runtime),
        resumeSession,
        ...(run.modelId ? { modelId: run.modelId } : {}),
        ...(userMessage.attachments.length > 0
          ? { attachments: userMessage.attachments }
          : {}),
      },
      async (event) => {
        if (!isBrokerEvent(event)) {
          return;
        }
        if (event.type === "agent.chunk") {
          chunks.push(event.delta);
        }
        if (event.type === "agent.done") {
          sawDone = true;
          if (event.exitCode !== 0) {
            cancelled = event.exitCode === -1;
            terminalError = cancelled
              ? "Run was cancelled"
              : `Run exited with code ${event.exitCode}`;
          }
        }
        if (event.type === "agent.error") {
          terminalError = event.message;
        }
        await persistBrokerEvent({
          event,
          projectId,
          sessionId: run.sessionId,
          runId,
          attemptId,
        });
      },
      ),
    );

    if (terminalError) {
      return { ok: false, message: terminalError, cancelled };
    }
    if (!sawDone) {
      return {
        ok: false,
        message: "Run execution ended without a terminal event",
      };
    }

    return { ok: true, agentMessage: chunks.join("") };
  };
}

function promptForRun(input: {
  prompt: string;
  runtime: ReturnType<typeof dbRuntimeToProtocol>;
  snapshot?: unknown;
}): string {
  if (input.runtime !== "openhands" || input.snapshot === undefined) {
    return input.prompt;
  }
  return prependOpenHandsLibrarySnapshotToPrompt({
    prompt: input.prompt,
    snapshot: input.snapshot,
  });
}

async function shouldResumeRun(run: {
  projectId: string;
  sessionId: string;
  providerSessionId: string;
  queueSequence: number;
  lastAttemptNumber: number;
}): Promise<boolean> {
  if (run.lastAttemptNumber > 1) {
    return true;
  }
  const previousRuns = await prisma.agentRun.count({
    where: {
      projectId: run.projectId,
      sessionId: run.sessionId,
      providerSessionId: run.providerSessionId,
      queueSequence: { lt: run.queueSequence },
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
    },
  });
  return previousRuns > 0;
}

async function persistBrokerEvent(input: {
  event: BrokerToHost;
  projectId: string;
  sessionId: string;
  runId: string;
  attemptId: string;
}): Promise<void> {
  const type = runEventTypeForBrokerEvent(input.event);
  if (!type) {
    return;
  }

  await appendRunEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    runId: input.runId,
    attemptId: input.attemptId,
    type,
    payload: toJsonPayload(input.event),
    agentId: agentIdForEvent(input.event),
  });
}

function runEventTypeForBrokerEvent(
  event: BrokerToHost,
): Parameters<typeof appendRunEvent>[0]["type"] | null {
  switch (event.type) {
    case "agent.chunk":
      return "CHUNK";
    case "agent.status":
    case "agent.session":
      return "STATUS";
    case "agent.tool_use":
      return "TOOL_USE";
    case "agent.usage":
      return "USAGE";
    case "file.changed":
      return "FILE_CHANGED";
    default:
      return null;
  }
}

function agentIdForEvent(event: BrokerToHost): string | null {
  return "agentId" in event && typeof event.agentId === "string"
    ? event.agentId
    : null;
}

function isBrokerEvent(value: unknown): value is BrokerToHost {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function toJsonPayload(value: unknown): Parameters<typeof appendRunEvent>[0]["payload"] {
  return JSON.parse(JSON.stringify(value)) as Parameters<typeof appendRunEvent>[0]["payload"];
}
