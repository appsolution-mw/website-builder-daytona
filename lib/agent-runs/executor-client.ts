import { prisma } from "@/lib/db/client";
import { dbRuntimeToProtocol, protocolRuntimeToDb } from "@/lib/agents/runtime";
import { prependOpenHandsLibrarySnapshotToPrompt } from "@/lib/agents/openhands-library-snapshot";
import {
  buildReplayContext,
  type ReplayMessage,
} from "@/lib/agents/runtimes/claude-code/replay-context";
import { estimateCostUsd } from "@/lib/agents/runtimes/claude-code/model-pricing";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import { resolveWorkerAgentClientConfig } from "@/lib/runtime/worker-pool";
import { withTokenRecovery } from "@/lib/runtime/worker-pool/with-token-recovery";
import type { AgentRuntime as PrismaAgentRuntime, Prisma } from "@prisma/client";
import type { AgentUsageDetails, BrokerToHost } from "@wbd/protocol";
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
    // Track the most recent modelId observed via agent.session so we can
    // estimate cost on agent.done when the upstream (e.g. OpenRouter) strips
    // total_cost_usd. The host's run.modelId is the requested model; the SDK
    // reports the actual model in system.init / agent.session, which is what
    // we want to bill against.
    let observedModelId: string | null = run.modelId ?? null;
    const resumeSession = await shouldResumeRun(run);
    const protocolRuntime = dbRuntimeToProtocol(run.runtime);
    const replayContext =
      protocolRuntime === "claude-code"
        ? await loadReplayContextForSession(run.sessionId)
        : undefined;
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
          runtime: protocolRuntime,
          snapshot: run.librarySnapshot?.snapshotJson,
        }),
        runtime: protocolRuntime,
        resumeSession,
        ...(run.modelId ? { modelId: run.modelId } : {}),
        ...(userMessage.attachments.length > 0
          ? { attachments: userMessage.attachments }
          : {}),
        ...(replayContext && replayContext.length > 0
          ? { replayContext }
          : {}),
      },
      async (event) => {
        if (!isBrokerEvent(event)) {
          return;
        }
        if (event.type === "agent.chunk") {
          chunks.push(event.delta);
        }
        if (event.type === "agent.session") {
          if (event.modelId) {
            observedModelId = event.modelId;
          }
          if (event.resumed === false) {
            console.warn(
              "[agent-runs] resume failed; replay fallback engaged",
              {
                projectId,
                sessionId: run.sessionId,
                runId,
                providerSessionId: event.providerSessionId,
              },
            );
          }
        }
        if (event.type === "agent.done") {
          sawDone = true;
          if (event.exitCode !== 0) {
            cancelled = event.exitCode === -1;
            terminalError = cancelled
              ? "Run was cancelled"
              : `Run exited with code ${event.exitCode}`;
          }
          await persistTurnSubtype({
            projectId,
            turnId: event.turnId,
            subtype: event.subtype,
            runtime: run.runtime,
            modelId: observedModelId,
            durationMs: event.durationMs,
            tokensIn: event.tokensIn,
            tokensOut: event.tokensOut,
            costUsd: event.costUsd,
            exitCode: event.exitCode,
            usage: event.usage,
          });
        }
        if (event.type === "agent.error") {
          terminalError = event.message;
        }
        // git.commit is emitted by the broker after the final agent.done; sawDone is already set.
        // Persist the Commit row and skip persistBrokerEvent — no AgentRunEvent for commits.
        // Also: receiving a git.commit means the agent produced real, committed
        // work, so we treat the run as successful even if agent.done reported a
        // non-zero exitCode (Claude Agent SDK's `error_during_execution` is
        // frequently a mid-flow hiccup after the actual file writes succeeded).
        // CANCELLED runs (exitCode -1) keep their cancellation status.
        if (event.type === "git.commit") {
          if (terminalError !== null && !cancelled) {
            terminalError = null;
          }
          await persistCommitEvent({
            event,
            projectId,
            sessionId: run.sessionId,
            runId,
          });
          return;
        }
        if (event.type === "git.commit.skipped") {
          return;
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

async function loadReplayContextForSession(
  sessionId: string,
): Promise<ReplayMessage[]> {
  const recent = await prisma.message.findMany({
    where: { sessionId, role: { in: ["USER", "AGENT"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      role: true,
      content: true,
      attachments: {
        orderBy: { position: "asc" },
        select: { name: true, sizeBytes: true },
      },
    },
  });
  // findMany with desc returns newest first — reverse so the chronological
  // order matches the original conversation.
  recent.reverse();
  return buildReplayContext(
    recent.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
      attachments: m.attachments,
    })),
  );
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
  // Resume any previous successful run in the same session+runtime, regardless
  // of providerSessionId. The SDK assigns its own session_id per turn (which
  // differs from the seed used on the first AgentRun row), so an exact
  // providerSessionId match would never resume after Turn 1. The agent-runner
  // detects mismatched session ids and triggers DB-replay fallback if needed.
  const previousRuns = await prisma.agentRun.count({
    where: {
      projectId: run.projectId,
      sessionId: run.sessionId,
      queueSequence: { lt: run.queueSequence },
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
    },
  });
  return previousRuns > 0;
}

async function persistTurnSubtype(input: {
  projectId: string;
  turnId: string;
  subtype: string | undefined;
  runtime: PrismaAgentRuntime;
  modelId: string | null;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exitCode: number;
  usage?: AgentUsageDetails | undefined;
}): Promise<void> {
  if (!input.subtype) {
    return;
  }

  // SDK-reported costUsd may be 0 when the upstream (e.g. OpenRouter) strips
  // total_cost_usd from the Anthropic-API-compat response. Token counts
  // remain authoritative. When cost is missing but tokens are present, fall
  // back to a price-table estimate so /usage rolls up something useful.
  const usage = input.usage;
  const inputTokens = usage?.inputTokens ?? input.tokensIn;
  const outputTokens = usage?.outputTokens ?? input.tokensOut;
  const cacheCreationInputTokens = usage?.cacheCreationInputTokens ?? 0;
  const cacheReadInputTokens = usage?.cacheReadInputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;
  const hasTokens =
    inputTokens > 0 ||
    outputTokens > 0 ||
    cacheCreationInputTokens > 0 ||
    cacheReadInputTokens > 0;

  const costUsd =
    input.costUsd > 0 || !hasTokens
      ? input.costUsd
      : estimateCostUsd({
          modelId: input.modelId,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
        });

  try {
    const baseFields = {
      runtime: input.runtime,
      modelId: input.modelId,
      durationMs: input.durationMs,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalTokens,
      webSearchRequests: usage?.webSearchRequests ?? 0,
      webFetchRequests: usage?.webFetchRequests ?? 0,
      costUsd,
      exitCode: input.exitCode,
      subtype: input.subtype,
      serviceTier: usage?.serviceTier ?? null,
      inferenceGeo: usage?.inferenceGeo ?? null,
      rawUsage: jsonOrUndefined(usage?.rawUsage),
      modelUsage: jsonOrUndefined(usage?.modelUsage),
    } satisfies Partial<Prisma.TokenUsageUncheckedCreateInput>;
    await prisma.tokenUsage.upsert({
      where: {
        projectId_turnId_label: {
          projectId: input.projectId,
          turnId: input.turnId,
          label: "TURN",
        },
      },
      create: {
        projectId: input.projectId,
        turnId: input.turnId,
        label: "TURN",
        ...baseFields,
      },
      update: baseFields,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[agent-runs] failed to persist turn usage for run ${input.turnId}: ${message}`,
    );
  }
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

async function persistCommitEvent(input: {
  event: Extract<BrokerToHost, { type: "git.commit" }>;
  projectId: string;
  sessionId: string;
  runId: string;
}): Promise<void> {
  const { event, projectId, sessionId, runId } = input;
  const data = {
    projectId,
    sessionId,
    agentRunId: runId,
    sha: event.sha,
    shortSha: event.shortSha,
    authorKind: event.authorKind,
    runtime: protocolRuntimeToDb(event.runtime),
    modelId: event.modelId,
    title: event.title,
    bodyMessage: event.bodyMessage,
    filesChanged: event.filesChanged,
    insertions: event.insertions,
    deletions: event.deletions,
    createdAt: new Date(event.committedAt),
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.commit.create({ data });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        console.warn(
          `[agent-runs] commit persist attempt 1 failed for run ${runId} sha ${event.sha}, retrying: ${message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      } else {
        console.error(
          `[agent-runs] failed to persist commit ${event.sha} for run ${runId} after 2 attempts: ${message}`,
        );
      }
    }
  }
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

export function runEventTypeForBrokerEvent(
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
    case "agent.policy_violation":
      return "POLICY_VIOLATION";
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
