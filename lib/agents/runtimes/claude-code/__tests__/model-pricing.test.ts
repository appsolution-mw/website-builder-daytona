import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../model-pricing";

describe("estimateCostUsd", () => {
  it("returns 0 when modelId is missing", () => {
    expect(
      estimateCostUsd({ modelId: null, inputTokens: 100, outputTokens: 100 }),
    ).toBe(0);
    expect(
      estimateCostUsd({
        modelId: undefined,
        inputTokens: 100,
        outputTokens: 100,
      }),
    ).toBe(0);
  });

  it("returns 0 for unknown model", () => {
    expect(
      estimateCostUsd({
        modelId: "unknown-model",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0);
  });

  it("computes Sonnet cost", () => {
    // 1M input + 1M output * sonnet rates = 3 + 15 = 18
    expect(
      estimateCostUsd({
        modelId: "claude-sonnet-4-6",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(18, 5);
  });

  it("computes Opus cost", () => {
    // 1M input + 1M output * opus rates = 15 + 75 = 90
    expect(
      estimateCostUsd({
        modelId: "claude-opus-4-7",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(90, 5);
  });

  it("includes cache read pricing when provided", () => {
    const cost = estimateCostUsd({
      modelId: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 5);
  });

  it("includes cache write pricing when provided", () => {
    const cost = estimateCostUsd({
      modelId: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it("normalizes anthropic/ prefix and [1m] suffix", () => {
    expect(
      estimateCostUsd({
        modelId: "anthropic/claude-sonnet-4-6[1m]",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(3, 5);
  });

  it("normalizes [1m] suffix alone", () => {
    expect(
      estimateCostUsd({
        modelId: "claude-opus-4-7[1m]",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(15, 5);
  });
});
