import type { OpenRouterModelOption } from "@/lib/openrouter/models";

// Curated Claude models the picker offers when runtime=claude-code.
// IDs are accepted directly by the Claude Code CLI / Anthropic API.
// `[1m]` suffix selects the 1M-token context variant of the model.
// Pricing is left null because Anthropic's per-token rates change
// independently from this codebase; the picker only needs label + context.
export const CLAUDE_CODE_MODELS: OpenRouterModelOption[] = [
  {
    id: "claude-opus-4-7[1m]",
    label: "Claude Opus 4.7 (1M context)",
    contextLength: 1_000_000,
    promptPrice: null,
    completionPrice: null,
    supportedParameters: ["tools"],
    inputModalities: ["text", "image"],
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    contextLength: 200_000,
    promptPrice: null,
    completionPrice: null,
    supportedParameters: ["tools"],
    inputModalities: ["text", "image"],
  },
  {
    id: "claude-sonnet-4-6[1m]",
    label: "Claude Sonnet 4.6 (1M context)",
    contextLength: 1_000_000,
    promptPrice: null,
    completionPrice: null,
    supportedParameters: ["tools"],
    inputModalities: ["text", "image"],
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    contextLength: 200_000,
    promptPrice: null,
    completionPrice: null,
    supportedParameters: ["tools"],
    inputModalities: ["text", "image"],
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    contextLength: 200_000,
    promptPrice: null,
    completionPrice: null,
    supportedParameters: ["tools"],
    inputModalities: ["text", "image"],
  },
];
