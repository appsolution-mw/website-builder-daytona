import type { AgentProvider } from "./agent-provider";
import type { AgentRuntime } from "@wbd/protocol";
import { agentRuntimeFromEnv } from "./agent-provider";
import { runClaudeTurn, runReviewerPass, type SpawnFn } from "./claude-runner";
import { runCodexReviewPass, runCodexTurn } from "./codex-runner";
import { runOpenHandsReviewPass, runOpenHandsTurn } from "./openhands-runner";
import { runVercelAiReviewPass, runVercelAiTurn } from "./vercel-ai-runner";

export interface CreateAgentProviderOptions {
  __testSpawn?: SpawnFn;
  runtime?: AgentRuntime;
}

export function createAgentProvider(opts: CreateAgentProviderOptions = {}): AgentProvider {
  const runtime = opts.runtime ?? agentRuntimeFromEnv();

  if (runtime === "openai-codex") {
    return {
      runtime,
      runTurn: (turn) => runCodexTurn(turn),
      runReview: (review) => runCodexReviewPass(review),
    };
  }

  if (runtime === "vercel-ai") {
    return {
      runtime,
      runTurn: (turn) => runVercelAiTurn(turn),
      runReview: (review) => runVercelAiReviewPass(review),
    };
  }

  if (runtime === "openhands") {
    return {
      runtime,
      runTurn: (turn) => runOpenHandsTurn(turn, opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined),
      runReview: (review) =>
        runOpenHandsReviewPass(review, opts.__testSpawn ? { spawn: opts.__testSpawn } : undefined),
    };
  }

  return {
    runtime: "claude-code",
    runTurn: (turn) =>
      runClaudeTurn(
        {
          projectId: turn.projectId,
          providerSessionId: turn.sessionId,
          resumeSession: turn.resumeSession,
          prompt: turn.prompt,
          turnId: turn.turnId,
          modelId: turn.modelId,
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
