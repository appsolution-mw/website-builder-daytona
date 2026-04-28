import { afterEach, describe, expect, it } from "vitest";
import { collectBrokerEnv } from "../index";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("worker-pool broker env", () => {
  it("maps OPENROUTER_API_KEY into Claude Code's Anthropic-compatible env", () => {
    expect(collectBrokerEnv({
      AGENT_RUNTIME: "claude-code",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      CLAUDE_MODEL: "claude-sonnet-4-6",
      CLAUDE_REVIEWER_MODEL: "claude-sonnet-4-6",
    })).toMatchObject({
      AGENT_RUNTIME: "claude-code",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      ANTHROPIC_API_KEY: "sk-or-v1-test",
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      CLAUDE_MODEL: "claude-sonnet-4-6",
      CLAUDE_REVIEWER_MODEL: "claude-sonnet-4-6",
    });
  });

  it("passes OpenRouter Vercel AI SDK settings into sandboxes", () => {
    expect(collectBrokerEnv({
      AGENT_RUNTIME: "vercel-ai",
      OPENAI_API_KEY: "sk-test",
      CODEX_API_KEY: "codex-test",
      CODEX_MODEL: "gpt-5.5",
      CODEX_SANDBOX_MODE: "danger-full-access",
      CODEX_REVIEWER_SANDBOX_MODE: "danger-full-access",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      VERCEL_AI_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
      VERCEL_AI_REVIEWER_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
    })).toMatchObject({
      AGENT_RUNTIME: "vercel-ai",
      OPENAI_API_KEY: "sk-test",
      CODEX_API_KEY: "codex-test",
      CODEX_MODEL: "gpt-5.5",
      CODEX_SANDBOX_MODE: "danger-full-access",
      CODEX_REVIEWER_SANDBOX_MODE: "danger-full-access",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      VERCEL_AI_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
      VERCEL_AI_REVIEWER_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
    });
  });

  it("can collect broker env from an explicit env source", () => {
    expect(collectBrokerEnv({
      AGENT_RUNTIME: "vercel-ai",
      OPENAI_API_KEY: "sk-file",
      VERCEL_AI_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
    })).toMatchObject({
      AGENT_RUNTIME: "vercel-ai",
      OPENAI_API_KEY: "sk-file",
      VERCEL_AI_MODEL: "openrouter:anthropic/claude-sonnet-4.6",
    });
  });
});
