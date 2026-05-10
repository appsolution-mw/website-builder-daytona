import type { AgentProvider } from "./agent-provider";
import type { AgentRuntime } from "@wbd/protocol";
import { agentRuntimeFromEnv } from "./agent-provider";
import { runClaudeSdkTurn } from "./claude-sdk-bridge";
import { runCodexReviewPass, runCodexTurn } from "./codex-runner";
import { runOpenHandsReviewPass, runOpenHandsTurn } from "./openhands-runner";
import type { SpawnFn } from "./spawn-types";

export interface CreateAgentProviderOptions {
  __testSpawn?: SpawnFn;
  runtime?: AgentRuntime;
}

const DEFAULT_AGENT_RUNNER_URL = "http://127.0.0.1:7050";

export function createAgentProvider(opts: CreateAgentProviderOptions = {}): AgentProvider {
  const runtime = opts.runtime ?? agentRuntimeFromEnv();

  if (runtime === "openai-codex") {
    return {
      runtime,
      runTurn: (turn) => runCodexTurn(turn),
      runReview: (review) => runCodexReviewPass(review),
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

  // claude-code: forward turns to the agent-runner via the SDK bridge.
  // The reviewer subagent now lives as a SDK Agent under
  // `agent-context/agents/`, so the broker no longer ships its own runReview
  // for claude-code.
  return {
    runtime: "claude-code",
    runTurn: (turn) =>
      runClaudeSdkTurn({
        runnerUrl: process.env.AGENT_RUNNER_URL ?? DEFAULT_AGENT_RUNNER_URL,
        hmacSecret: process.env.AGENT_RUNNER_HMAC_SECRET ?? "",
        sessionId: turn.sessionId,
        providerSessionId: turn.sessionId,
        resumeRequested: turn.resumeSession,
        prompt: turn.prompt,
        turnId: turn.turnId,
        ...(turn.modelId !== undefined ? { modelId: turn.modelId } : {}),
        ...(turn.attachments
          ? {
              attachments: turn.attachments.map((a) => ({
                name: a.name,
                mimeType: a.mimeType,
                dataBase64: a.dataBase64,
              })),
            }
          : {}),
        ...(turn.replayContext && turn.replayContext.length > 0
          ? { replayContext: turn.replayContext }
          : {}),
        onEvent: turn.onEvent,
        ...(turn.signal ? { signal: turn.signal } : {}),
      }),
  };
}
