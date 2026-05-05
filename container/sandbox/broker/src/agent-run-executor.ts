import type { AgentRuntime, BrokerToHost } from "@wbd/protocol";
import { createAgentProvider } from "./agent-provider-factory";
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
  await provider.runTurn({
    projectId: input.projectId,
    sessionId: input.providerSessionId,
    resumeSession: input.resumeSession,
    prompt: input.prompt,
    turnId: input.runId,
    projectRoot: input.projectRoot,
    modelId: input.modelId,
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
