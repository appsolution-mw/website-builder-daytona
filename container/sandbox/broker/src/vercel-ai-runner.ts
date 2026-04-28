import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, generateText } from "ai";
import type { AgentUsageDetails } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";

type ProviderModelId = `anthropic:${string}` | `openai:${string}`;

const DEFAULT_MODEL: ProviderModelId = "openai:gpt-5.2";
const DEFAULT_REVIEWER_MODEL: ProviderModelId = "openai:gpt-5.2";
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";

type HistoryEntry = { role: "user" | "assistant"; content: string };

const histories = new Map<string, HistoryEntry[]>();

function createRegistry() {
  return createProviderRegistry({
    anthropic,
    openai: createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }),
  });
}

function normalizeModelId(modelId: string | undefined): ProviderModelId {
  const candidate = (modelId || process.env.VERCEL_AI_MODEL || DEFAULT_MODEL).trim();
  if (candidate.startsWith("anthropic:")) {
    return candidate as `anthropic:${string}`;
  }
  if (candidate.startsWith("openai:")) {
    return candidate as `openai:${string}`;
  }
  return `openai:${candidate}`;
}

function resolveModel(modelId: string | undefined) {
  const registry = createRegistry();
  return registry.languageModel(normalizeModelId(modelId));
}

function usageDetails(rawUsage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined): AgentUsageDetails | undefined {
  if (!rawUsage) return undefined;
  const inputTokens = rawUsage.inputTokens ?? 0;
  const outputTokens = rawUsage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: rawUsage.totalTokens ?? inputTokens + outputTokens,
    webSearchRequests: 0,
    webFetchRequests: 0,
    rawUsage,
    modelUsage: rawUsage,
  };
}

function extractUsage(result: unknown) {
  const usage = (result as {
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }).usage;
  return usageDetails(usage);
}

function compilePrompt(prompt: string, history: HistoryEntry[]): string {
  if (history.length === 0) return prompt;
  const transcript = history
    .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
    .join("\n\n");
  return `${transcript}\n\nUser: ${prompt}`;
}

export async function runVercelAiTurn(opts: AgentTurnOptions): Promise<void> {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!apiKeyPresent) {
    opts.onEvent({
      type: "agent.error",
      turnId: opts.turnId,
      message: "vercel-ai runtime requires OPENAI_API_KEY or ANTHROPIC_API_KEY.",
    });
    return;
  }

  opts.onEvent({ type: "agent.status", turnId: opts.turnId, phase: "starting" });
  opts.onEvent({ type: "agent.status", turnId: opts.turnId, phase: "thinking" });

  const history = opts.resumeSession ? (histories.get(opts.sessionId) ?? []) : [];
  const compiledPrompt = compilePrompt(opts.prompt, history);
  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: resolveModel(opts.modelId),
      prompt: compiledPrompt,
      abortSignal: opts.signal,
    });

    const nextHistory: HistoryEntry[] = [
      ...history,
      { role: "user", content: opts.prompt },
      { role: "assistant", content: result.text },
    ];
    histories.set(opts.sessionId, nextHistory);

    if (result.text) {
      opts.onEvent({
        type: "agent.chunk",
        turnId: opts.turnId,
        delta: result.text,
        agentId: "coder",
      });
    }

    const usage = extractUsage(result);

    opts.onEvent({
      type: "agent.done",
      turnId: opts.turnId,
      durationMs: Date.now() - startedAt,
      tokensIn: usage?.inputTokens ?? 0,
      tokensOut: usage?.outputTokens ?? 0,
      costUsd: 0,
      exitCode: 0,
      ...(usage ? { usage } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts.onEvent({
      type: "agent.error",
      turnId: opts.turnId,
      message,
    });
  }
}

export async function runVercelAiReviewPass(opts: AgentReviewOptions): Promise<void> {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!apiKeyPresent) return;

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: resolveModel(process.env.VERCEL_AI_REVIEWER_MODEL || DEFAULT_REVIEWER_MODEL),
      prompt: REVIEWER_PROMPT,
      abortSignal: opts.signal,
    });

    if (result.text) {
      opts.onEvent({
        type: "agent.chunk",
        turnId: opts.turnId,
        delta: result.text,
        agentId: "reviewer",
      });
    }

    const usage = extractUsage(result);

    opts.onEvent({
      type: "agent.done",
      turnId: opts.turnId,
      durationMs: Date.now() - startedAt,
      tokensIn: usage?.inputTokens ?? 0,
      tokensOut: usage?.outputTokens ?? 0,
      costUsd: 0,
      exitCode: 0,
      ...(usage ? { usage } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    opts.onEvent({
      type: "agent.error",
      turnId: opts.turnId,
      message,
      agentId: "reviewer",
    });
  }
}
