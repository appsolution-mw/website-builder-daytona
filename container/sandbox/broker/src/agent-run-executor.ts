import type { AgentRuntime, BrokerToHost, PromptImageAttachment } from "@wbd/protocol";
import { createAgentProvider } from "./agent-provider-factory";
import { prepareDiskAttachments } from "./chat-attachments";
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
}
