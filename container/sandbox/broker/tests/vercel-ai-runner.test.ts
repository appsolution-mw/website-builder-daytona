import { afterEach, describe, expect, it } from "vitest";
import { getRequiredApiKeyName, normalizeModelId } from "../src/vercel-ai-runner";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("vercel-ai runner config", () => {
  it("keeps explicit OpenRouter model ids instead of falling back to OpenAI", () => {
    process.env.VERCEL_AI_MODEL = "openrouter:anthropic/claude-sonnet-4.6";

    expect(normalizeModelId(undefined)).toBe("openrouter:anthropic/claude-sonnet-4.6");
  });

  it("requires the OpenRouter key for OpenRouter models", () => {
    expect(getRequiredApiKeyName("openrouter:anthropic/claude-sonnet-4.6")).toBe("OPENROUTER_API_KEY");
  });
});
