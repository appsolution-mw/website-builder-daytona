import type { AgentRuntime, BrokerToHost, PromptImageAttachment } from "@wbd/protocol";
import { createAgentProvider } from "./agent-provider-factory";
import { prepareDiskAttachments } from "./chat-attachments";
import { commitAgentTurn } from "./git-handlers";
import type { SpawnFn } from "./spawn-types";

export type PersistRunEvent = (event: BrokerToHost) => Promise<void>;

export async function executeAgentRun(input: {
  projectId: string;
  sessionId: string;
  providerSessionId: string;
  runId: string;
  attemptId: string;
  prompt: string;
  runtime: AgentRuntime;
  resumeSession: boolean;
  modelId?: string;
  attachments?: PromptImageAttachment[];
  /** Optional last-N replay context (Task 14). Only forwarded for claude-code. */
  replayContext?: Array<{ role: "user" | "assistant"; text: string }>;
  projectRoot: string;
  signal: AbortSignal;
  persistEvent: PersistRunEvent;
  broadcastEvent: (event: BrokerToHost) => void;
  __testSpawn?: SpawnFn;
}): Promise<void> {
  const provider = createAgentProvider({
    runtime: input.runtime,
    ...(input.__testSpawn ? { __testSpawn: input.__testSpawn } : {}),
  });

  const hasAttachments = !!(input.attachments && input.attachments.length > 0);

  let prompt = input.prompt;
  let attachmentsForRunner: PromptImageAttachment[] | undefined;
  let attachmentPathsForRunner: string[] | undefined;

  if (hasAttachments) {
    if (input.runtime === "claude-code") {
      // Claude Code auto-detects `@path` references in the prompt. Write images
      // to disk and append a marker block referencing them; do not forward
      // base64 to the runner.
      const prepared = await prepareDiskAttachments({
        projectRoot: input.projectRoot,
        runId: input.runId,
        attachments: input.attachments!,
      });
      prompt = `${input.prompt}${prepared.promptSuffix}`;
    } else if (input.runtime === "openai-codex") {
      // Codex SDK accepts a multimodal Input array with {type:"local_image",
      // path} entries. Write images to disk and pass the absolute paths to the
      // runner; do NOT append the `@<path>` suffix — that would be redundant
      // text noise alongside the actual multimodal payload.
      const prepared = await prepareDiskAttachments({
        projectRoot: input.projectRoot,
        runId: input.runId,
        attachments: input.attachments!,
      });
      attachmentPathsForRunner = prepared.paths;
    } else if (input.runtime === "openhands") {
      // OpenHands runner writes its own manifest from AgentTurnOptions.attachments.
      // Pass through unchanged; do NOT pre-write to disk here.
      attachmentsForRunner = input.attachments;
    }
    // vercel-ai: ignore — host already rejects vercel-ai + attachments combos.
  }

  let aborted = input.signal.aborted;
  const onAbort = () => {
    aborted = true;
  };
  input.signal.addEventListener("abort", onAbort);

  try {
    await provider.runTurn({
      projectId: input.projectId,
      sessionId: input.providerSessionId,
      resumeSession: input.resumeSession,
      prompt,
      turnId: input.runId,
      projectRoot: input.projectRoot,
      modelId: input.modelId,
      ...(attachmentsForRunner ? { attachments: attachmentsForRunner } : {}),
      ...(attachmentPathsForRunner ? { attachmentPaths: attachmentPathsForRunner } : {}),
      ...(input.runtime === "claude-code" && input.replayContext && input.replayContext.length > 0
        ? { replayContext: input.replayContext }
        : {}),
      onEvent: async (event) => {
        await input.persistEvent(event);
        input.broadcastEvent(event);
      },
      signal: input.signal,
      run: {
        runId: input.runId,
        attemptId: input.attemptId,
        conversationId: input.providerSessionId,
        persistenceDir: `${input.projectRoot}/.agent-artifacts/openhands/conversations`,
      },
    });
  } finally {
    input.signal.removeEventListener("abort", onAbort);
  }

  if (aborted) return;

  // Run the commit hook regardless of agent.done exitCode. Claude Agent SDK's
  // `error_during_execution` subtype frequently fires after the agent has
  // already written real, valid changes (mid-flow tool hiccup, sub-agent
  // recovery, late cleanup error). commitAgentTurn's own no_changes branch
  // handles the "nothing was actually written" case — so we only ever commit
  // when the working tree is dirty.
  const commitResult = await commitAgentTurn({
    projectRoot: input.projectRoot,
    runId: input.runId,
    userPromptFirstLine: firstNonEmptyLine(input.prompt),
    userPromptFull: input.prompt,
    runtime: input.runtime,
    modelId: input.modelId ?? null,
  });

  const commitEvent: BrokerToHost = commitResult.ok
    ? {
        type: "git.commit",
        turnId: input.runId,
        sha: commitResult.sha,
        shortSha: commitResult.shortSha,
        title: commitResult.title,
        bodyMessage: commitResult.bodyMessage,
        filesChanged: commitResult.filesChanged,
        insertions: commitResult.insertions,
        deletions: commitResult.deletions,
        runtime: input.runtime,
        modelId: input.modelId ?? null,
        authorKind: "AGENT",
        committedAt: commitResult.committedAt,
      }
    : commitResult.reason === "no_changes"
      ? {
          type: "git.commit.skipped",
          turnId: input.runId,
          reason: "no_changes",
        }
      : {
          type: "git.commit.skipped",
          turnId: input.runId,
          reason: "commit_failed",
          detail: commitResult.detail,
        };

  await input.persistEvent(commitEvent);
  input.broadcastEvent(commitEvent);
}

function firstNonEmptyLine(input: string): string | null {
  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
