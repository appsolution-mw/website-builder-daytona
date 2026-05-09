/**
 * Claude model pricing table for best-effort cost estimation.
 *
 * Used when the Claude Agent SDK reports `total_cost_usd === 0` on a
 * successful turn — this happens with OpenRouter and other Anthropic-API
 * compatible upstreams that strip the cost field from the Anthropic response
 * envelope. Token counts remain authoritative (from SDK `result.usage`);
 * cost is a best-effort estimate computed from token counts and the public
 * Anthropic pricing.
 *
 * Prices are per million tokens (USD). Source:
 * https://www.anthropic.com/pricing — keep this table in sync when Anthropic
 * publishes new tiers. Conservative defaults are preferred over guessing.
 */
const PRICES_USD_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead?: number; cacheWrite?: number }
> = {
  "claude-opus-4-5": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-7": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface EstimateCostInput {
  modelId: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Estimate USD cost for a single SDK turn from token counts.
 *
 * Returns 0 when the model is unknown or the modelId is missing — callers
 * MUST treat 0 as "no estimate available" and not as a free turn.
 */
export function estimateCostUsd(args: EstimateCostInput): number {
  if (!args.modelId) return 0;
  const key = normalizeModelId(args.modelId);
  const price = PRICES_USD_PER_MTOK[key];
  if (!price) return 0;

  let total =
    (args.inputTokens / 1_000_000) * price.input +
    (args.outputTokens / 1_000_000) * price.output;

  if (args.cacheReadInputTokens && price.cacheRead) {
    total += (args.cacheReadInputTokens / 1_000_000) * price.cacheRead;
  }
  if (args.cacheCreationInputTokens && price.cacheWrite) {
    total += (args.cacheCreationInputTokens / 1_000_000) * price.cacheWrite;
  }

  return total;
}

/**
 * Strip the OpenRouter `anthropic/` prefix and the SDK `[1m]` context-window
 * suffix so price-table lookups work for both forms:
 *   - "anthropic/claude-sonnet-4-6"
 *   - "claude-opus-4-7[1m]"
 */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/^anthropic\//, "").replace(/\[1m\]$/, "");
}
