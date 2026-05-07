import type { AgentRuntime, BrokerToHost, PromptImageAttachment } from "@wbd/protocol";
import { createAgentProvider } from "./agent-provider-factory";
import { prepareDiskAttachments } from "./chat-attachments";
import type { SpawnFn } from "./claude-runner";

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

  if (hasAttachments) {
    if (input.runtime === "claude-code" || input.runtime === "openai-codex") {
      // Claude Code auto-detects `@path` references; Codex SDK takes a string
      // prompt and can be told to read the file via tools. Write images to
      // disk and append a marker block; do not forward base64 to the runner.
      const prepared = await prepareDiskAttachments({
        projectRoot: input.projectRoot,
        runId: input.runId,
        attachments: input.attachments!,
      });
      prompt = `${input.prompt}${prepared.promptSuffix}`;
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
