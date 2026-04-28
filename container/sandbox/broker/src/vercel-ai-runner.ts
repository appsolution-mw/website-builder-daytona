import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, generateText, stepCountIs } from "ai";
import type { AgentUsageDetails } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";
import { createVercelAiTools } from "./vercel-ai-tools";

type ProviderModelId = `anthropic:${string}` | `openai:${string}` | `openrouter:${string}`;
type RequiredApiKeyName = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "OPENROUTER_API_KEY";

const DEFAULT_MODEL: ProviderModelId = "openai:gpt-5.2";
const DEFAULT_REVIEWER_MODEL: ProviderModelId = "openai:gpt-5.2";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";
const PROJECT_ROOT = "/workspace/project";
const MAX_AGENT_STEPS = 20;
const AGENT_SYSTEM_PROMPT = [
  "You are a coding agent working inside a sandboxed project directory.",
  "Use tools to inspect the project before editing files.",
  "Read relevant files before changing them.",
  "Prefer small, focused edits. Preserve existing style and dependencies.",
  "When writing a file, provide the complete replacement content for that file.",
  "Run relevant checks when possible and report what changed.",
  "Do not edit files outside the project directory.",
].join("\n");

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

function createOpenRouter() {
  return createOpenAI({
    name: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY,
  });
}

export function normalizeModelId(modelId: string | undefined): ProviderModelId {
  const candidate = (modelId || process.env.VERCEL_AI_MODEL || DEFAULT_MODEL).trim();
  if (candidate.startsWith("anthropic:")) {
    return candidate as `anthropic:${string}`;
  }
  if (candidate.startsWith("openai:")) {
    return candidate as `openai:${string}`;
  }
  if (candidate.startsWith("openrouter:")) {
    return candidate as `openrouter:${string}`;
  }
  return `openai:${candidate}`;
}

export function getRequiredApiKeyName(modelId: ProviderModelId): RequiredApiKeyName {
  if (modelId.startsWith("anthropic:")) return "ANTHROPIC_API_KEY";
  if (modelId.startsWith("openrouter:")) return "OPENROUTER_API_KEY";
  return "OPENAI_API_KEY";
}

function apiKeyMissingMessage(modelId: ProviderModelId): string | undefined {
  const keyName = getRequiredApiKeyName(modelId);
  return process.env[keyName]
    ? undefined
    : `vercel-ai runtime model '${modelId}' requires ${keyName}.`;
}

function resolveModel(modelId: string | undefined) {
  const normalized = normalizeModelId(modelId);
  if (normalized.startsWith("openrouter:")) {
    const openrouter = createOpenRouter();
    const openrouterModelId = normalized.slice("openrouter:".length);
    return openrouter.chat(openrouterModelId as Parameters<typeof openrouter.chat>[0]);
  }
  const registry = createRegistry();
  return registry.languageModel(normalized as `anthropic:${string}` | `openai:${string}`);
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
  const normalizedModelId = normalizeModelId(opts.modelId);
  const missingKeyMessage = apiKeyMissingMessage(normalizedModelId);
  if (missingKeyMessage) {
    opts.onEvent({
      type: "agent.error",
      turnId: opts.turnId,
      message: missingKeyMessage,
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
      system: AGENT_SYSTEM_PROMPT,
      prompt: compiledPrompt,
      tools: createVercelAiTools({
        projectRoot: opts.projectRoot ?? PROJECT_ROOT,
        turnId: opts.turnId,
        onEvent: opts.onEvent,
      }),
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
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
  const reviewerModelId = normalizeModelId(process.env.VERCEL_AI_REVIEWER_MODEL || DEFAULT_REVIEWER_MODEL);
  if (apiKeyMissingMessage(reviewerModelId)) return;

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: resolveModel(reviewerModelId),
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
