import { stat } from "node:fs/promises";
import {
  Codex,
  type ModelReasoningEffort,
  type SandboxMode,
  type Thread,
  type ThreadEvent,
  type ThreadItem,
} from "@openai/codex-sdk";
import type { AgentUsageDetails, BrokerToHost } from "@wbd/protocol";
import type { AgentReviewOptions, AgentTurnOptions } from "./agent-provider";

async function filterReadablePaths(paths: string[]): Promise<string[]> {
  const checked = await Promise.all(
    paths.map(async (path) => {
      try {
        const info = await stat(path);
        return info.isFile() && info.size > 0 ? path : null;
      } catch {
        return null;
      }
    }),
  );
  return checked.filter((value): value is string => value !== null);
}

function attachmentPromptPreface(count: number): string {
  return count === 1
    ? "The user attached 1 image via the runtime image-input channel. Examine it carefully before responding.\n\n"
    : `The user attached ${count} images via the runtime image-input channel. Examine each one carefully before responding.\n\n`;
}

const DEFAULT_CODEX_MODEL = "gpt-5.4";
const DEFAULT_CODEX_SANDBOX_MODE: SandboxMode = "danger-full-access";
const REVIEWER_PROMPT =
  "Review the uncommitted changes from this turn. Do not edit files. Output only concise issue bullets, or say Passed.";

const threads = new Map<string, Thread>();
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function reasoningEffortFromEnv(name: string, fallback: ModelReasoningEffort): ModelReasoningEffort {
  const value = process.env[name]?.trim().toLowerCase();
  return value && REASONING_EFFORTS.has(value) ? (value as ModelReasoningEffort) : fallback;
}

export function codexSandboxModeFromEnv(name: string, fallback: SandboxMode): SandboxMode {
  const value = process.env[name]?.trim();
  return value && SANDBOX_MODES.has(value) ? (value as SandboxMode) : fallback;
}

function stringEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function createCodex(): Codex {
  const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  return new Codex({
    ...(apiKey ? { apiKey } : {}),
    env: {
      ...stringEnv(),
      ...(apiKey ? { CODEX_API_KEY: apiKey, OPENAI_API_KEY: apiKey } : {}),
    },
    config: {
      hide_agent_reasoning: true,
    },
  });
}

function usageDetails(usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number }): AgentUsageDetails {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: usage.cached_input_tokens,
    totalTokens: usage.input_tokens + usage.cached_input_tokens + usage.output_tokens,
    webSearchRequests: 0,
    webFetchRequests: 0,
    rawUsage: usage,
  };
}

function statusForItem(item: ThreadItem, turnId: string, agentId?: string): BrokerToHost | null {
  switch (item.type) {
    case "command_execution":
      return {
        type: "agent.status",
        turnId,
        phase: "tool_use",
        detail: "Bash",
        ...(agentId ? { agentId } : {}),
      };
    case "file_change":
      return {
        type: "agent.status",
        turnId,
        phase: "writing_file",
        detail: item.changes.map((change) => change.path).join(", "),
        ...(agentId ? { agentId } : {}),
      };
    case "mcp_tool_call":
      return {
        type: "agent.status",
        turnId,
        phase: "tool_use",
        detail: `${item.server}/${item.tool}`,
        ...(agentId ? { agentId } : {}),
      };
    case "web_search":
      return {
        type: "agent.status",
        turnId,
        phase: "tool_use",
        detail: "WebSearch",
        ...(agentId ? { agentId } : {}),
      };
    case "reasoning":
    case "todo_list":
      return {
        type: "agent.status",
        turnId,
        phase: "thinking",
        ...(agentId ? { agentId } : {}),
      };
    default:
      return null;
  }
}

function toolUseForItem(item: ThreadItem, turnId: string, agentId?: string): BrokerToHost | null {
  switch (item.type) {
    case "command_execution":
      return {
        type: "agent.tool_use",
        turnId,
        tool: "Bash",
        input: { command: item.command },
        ...(agentId ? { agentId } : {}),
      };
    case "file_change":
      return {
        type: "agent.tool_use",
        turnId,
        tool: "ApplyPatch",
        input: { changes: item.changes, status: item.status },
        ...(agentId ? { agentId } : {}),
      };
    case "mcp_tool_call":
      return {
        type: "agent.tool_use",
        turnId,
        tool: `mcp__${item.server}__${item.tool}`,
        input: item.arguments,
        ...(agentId ? { agentId } : {}),
      };
    case "web_search":
      return {
        type: "agent.tool_use",
        turnId,
        tool: "WebSearch",
        input: { query: item.query },
        ...(agentId ? { agentId } : {}),
      };
    default:
      return null;
  }
}

function eventsForThreadEvent(
  event: ThreadEvent,
  turnId: string,
  startedAt: number,
  agentId?: string,
): BrokerToHost[] {
  switch (event.type) {
    case "thread.started":
      return [];
    case "turn.started":
      return [{ type: "agent.status", turnId, phase: "starting", ...(agentId ? { agentId } : {}) }];
    case "item.started":
      return [toolUseForItem(event.item, turnId, agentId), statusForItem(event.item, turnId, agentId)].filter(
        Boolean,
      ) as BrokerToHost[];
    case "item.updated":
      return [statusForItem(event.item, turnId, agentId)].filter(Boolean) as BrokerToHost[];
    case "item.completed":
      if (event.item.type === "agent_message") {
        return [{ type: "agent.chunk", turnId, delta: event.item.text, ...(agentId ? { agentId } : {}) }];
      }
      if (event.item.type === "error") {
        return [{ type: "agent.error", turnId, message: event.item.message, ...(agentId ? { agentId } : {}) }];
      }
      return [toolUseForItem(event.item, turnId, agentId), statusForItem(event.item, turnId, agentId)].filter(
        Boolean,
      ) as BrokerToHost[];
    case "turn.completed": {
      const usage = usageDetails(event.usage);
      return [
        {
          type: "agent.done",
          turnId,
          durationMs: Date.now() - startedAt,
          tokensIn: usage.inputTokens,
          tokensOut: usage.outputTokens,
          costUsd: 0,
          exitCode: 0,
          usage,
        },
      ];
    }
    case "turn.failed":
      return [{ type: "agent.error", turnId, message: event.error.message, ...(agentId ? { agentId } : {}) }];
    case "error":
      return [{ type: "agent.error", turnId, message: event.message, ...(agentId ? { agentId } : {}) }];
  }
}

async function runThread(args: {
  thread: Thread;
  prompt: string;
  turnId: string;
  onEvent: (event: BrokerToHost) => unknown;
  signal?: AbortSignal;
  agentId?: string;
  attachmentPaths?: string[];
}): Promise<void> {
  const startedAt = Date.now();
  let sawTerminal = false;

  const readablePaths =
    args.attachmentPaths && args.attachmentPaths.length > 0
      ? await filterReadablePaths(args.attachmentPaths)
      : [];
  const droppedPaths =
    args.attachmentPaths && args.attachmentPaths.length > readablePaths.length
      ? args.attachmentPaths.filter((path) => !readablePaths.includes(path))
      : [];

  const promptText =
    readablePaths.length > 0
      ? `${attachmentPromptPreface(readablePaths.length)}${args.prompt}`
      : args.prompt;
  const input =
    readablePaths.length > 0
      ? [
          { type: "text" as const, text: promptText },
          ...readablePaths.map((path) => ({ type: "local_image" as const, path })),
        ]
      : promptText;

  console.log(
    `[broker codex] turnId=${args.turnId} attachments=${readablePaths.length}` +
      (droppedPaths.length > 0 ? ` dropped=${droppedPaths.length}` : "") +
      (readablePaths.length > 0 ? ` paths=${JSON.stringify(readablePaths)}` : ""),
  );

  const { events } = await args.thread.runStreamed(input, { signal: args.signal });

  for await (const event of events) {
    for (const mapped of eventsForThreadEvent(event, args.turnId, startedAt, args.agentId)) {
      if (mapped.type === "agent.done" || mapped.type === "agent.error") sawTerminal = true;
      await args.onEvent(mapped);
    }
  }

  if (!sawTerminal && args.signal?.aborted) {
    await args.onEvent({
      type: "agent.done",
      turnId: args.turnId,
      durationMs: Date.now() - startedAt,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      exitCode: -1,
    });
  }
}

export async function runCodexTurn(opts: AgentTurnOptions): Promise<void> {
  if (!process.env.CODEX_API_KEY && !process.env.OPENAI_API_KEY) {
    await opts.onEvent({
      type: "agent.error",
      turnId: opts.turnId,
      message: "openai-codex runtime requires CODEX_API_KEY or OPENAI_API_KEY.",
    });
    return;
  }

  const codex = createCodex();
  const thread =
    opts.resumeSession && threads.has(opts.sessionId)
      ? threads.get(opts.sessionId)!
      : codex.startThread({
          workingDirectory: "/workspace/project",
          skipGitRepoCheck: true,
          model: opts.modelId || process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
          modelReasoningEffort: reasoningEffortFromEnv("CODEX_REASONING_EFFORT", "medium"),
          sandboxMode: codexSandboxModeFromEnv("CODEX_SANDBOX_MODE", DEFAULT_CODEX_SANDBOX_MODE),
          approvalPolicy: "never",
          networkAccessEnabled: process.env.CODEX_NETWORK_ACCESS === "1",
        });

  threads.set(opts.sessionId, thread);
  await runThread({
    thread,
    prompt: opts.prompt,
    turnId: opts.turnId,
    onEvent: opts.onEvent,
    signal: opts.signal,
    ...(opts.attachmentPaths && opts.attachmentPaths.length > 0
      ? { attachmentPaths: opts.attachmentPaths }
      : {}),
  });
}

export async function runCodexReviewPass(opts: AgentReviewOptions): Promise<void> {
  if (!process.env.CODEX_API_KEY && !process.env.OPENAI_API_KEY) return;

  const codex = createCodex();
  const thread = codex.startThread({
    workingDirectory: "/workspace/project",
    skipGitRepoCheck: true,
    model: process.env.CODEX_REVIEWER_MODEL || process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL,
    modelReasoningEffort: reasoningEffortFromEnv("CODEX_REVIEWER_REASONING_EFFORT", "high"),
    sandboxMode: codexSandboxModeFromEnv(
      "CODEX_REVIEWER_SANDBOX_MODE",
      codexSandboxModeFromEnv("CODEX_SANDBOX_MODE", DEFAULT_CODEX_SANDBOX_MODE),
    ),
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });

  await runThread({
    thread,
    prompt: REVIEWER_PROMPT,
    turnId: opts.turnId,
    onEvent: opts.onEvent,
    signal: opts.signal,
    agentId: "reviewer",
  });
}
