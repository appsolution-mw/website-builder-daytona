import type { AgentProvider } from "./agent-provider";
import { agentRuntimeFromEnv } from "./agent-provider";
import { runClaudeTurn, runReviewerPass, type SpawnFn } from "./claude-runner";
import { runCodexReviewPass, runCodexTurn } from "./codex-runner";

export interface CreateAgentProviderOptions {
  __testSpawn?: SpawnFn;
}

export function createAgentProvider(opts: CreateAgentProviderOptions = {}): AgentProvider {
  const runtime = agentRuntimeFromEnv();

  if (runtime === "openai-codex") {
    return {
      runtime,
      runTurn: (turn) => runCodexTurn(turn),
      runReview: (review) => runCodexReviewPass(review),
    };
  }

  return {
    runtime: "claude-code",
    runTurn: (turn) =>
      runClaudeTurn(
        {
          projectId: turn.projectId,
          claudeSessionId: turn.sessionId,
          resumeClaudeSession: turn.resumeSession,
          prompt: turn.prompt,
          turnId: turn.turnId,
          onEvent: turn.onEvent,
          signal: turn.signal,
        },
        opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined,
      ),
    runReview: (review) =>
      runReviewerPass(
        {
          projectId: review.projectId,
          turnId: review.turnId,
          onEvent: review.onEvent,
          signal: review.signal,
        },
        opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined,
      ),
  };
}
