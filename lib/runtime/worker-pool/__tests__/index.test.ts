import { afterEach, describe, expect, it } from "vitest";
import {
  collectBrokerEnv,
  createHetznerWorkerPoolRuntime,
  resolveWorkerAgentClientConfig,
} from "../index";

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

  it("passes OpenHands runtime settings into sandboxes", () => {
    expect(collectBrokerEnv({
      AGENT_RUNTIME: "openhands",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      OPENHANDS_MODEL: "openrouter:qwen/qwen3-coder:free",
      OPENHANDS_REVIEWER_MODEL: "openrouter:qwen/qwen3-coder:free",
      OPENHANDS_BASE_URL: "https://openrouter.ai/api/v1",
      OPENHANDS_MAX_ITERATIONS: "30",
      OPENHANDS_ENABLE_PUBLIC_SKILLS: "0",
      LLM_API_KEY: "sk-llm-test",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
    })).toMatchObject({
      AGENT_RUNTIME: "openhands",
      OPENROUTER_API_KEY: "sk-or-v1-test",
      OPENHANDS_MODEL: "openrouter:qwen/qwen3-coder:free",
      OPENHANDS_REVIEWER_MODEL: "openrouter:qwen/qwen3-coder:free",
      OPENHANDS_BASE_URL: "https://openrouter.ai/api/v1",
      OPENHANDS_MAX_ITERATIONS: "30",
      OPENHANDS_ENABLE_PUBLIC_SKILLS: "0",
      LLM_API_KEY: "sk-llm-test",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
    });
  });
});

describe("createHetznerWorkerPoolRuntime", () => {
  it("returns a runtime when required env values are present", () => {
    process.env = {
      ...originalEnv,
      WBD_DISABLE_ENV_FILE_LOAD: "1",
      SANDBOX_IMAGE: "wbd/sandbox:dev",
      WORKER_AGENT_IMAGE: "wbd/worker-agent:dev",
      WORKER_AGENT_HMAC_SECRET: "x".repeat(32),
      HETZNER_API_TOKEN: "hetzner-token",
      TAILSCALE_API_KEY: "tailscale-key",
      TAILSCALE_TAILNET: "example.ts.net",
      APP_BASE_URL: "https://app.example.com",
      HETZNER_DEFAULT_REGION: "fsn1",
      HETZNER_DEFAULT_SERVER_TYPE: "ccx33",
      WORKER_DEFAULT_CAPACITY: "10",
    };

    const runtime = createHetznerWorkerPoolRuntime();

    expect(typeof runtime.spawnProjectSandbox).toBe("function");
  });

  it("throws a helpful error when Hetzner env is missing", () => {
    process.env = {
      ...originalEnv,
      WBD_DISABLE_ENV_FILE_LOAD: "1",
      SANDBOX_IMAGE: "wbd/sandbox:dev",
      WORKER_AGENT_HMAC_SECRET: "x".repeat(32),
    };

    expect(() => createHetznerWorkerPoolRuntime()).toThrow(/HETZNER_API_TOKEN/);
  });

  it("throws a helpful error when default worker capacity is invalid", () => {
    process.env = {
      ...originalEnv,
      WBD_DISABLE_ENV_FILE_LOAD: "1",
      SANDBOX_IMAGE: "wbd/sandbox:dev",
      WORKER_AGENT_IMAGE: "wbd/worker-agent:dev",
      WORKER_AGENT_HMAC_SECRET: "x".repeat(32),
      HETZNER_API_TOKEN: "hetzner-token",
      TAILSCALE_API_KEY: "tailscale-key",
      TAILSCALE_TAILNET: "example.ts.net",
      APP_BASE_URL: "https://app.example.com",
      WORKER_DEFAULT_CAPACITY: "0",
    };

    expect(() => createHetznerWorkerPoolRuntime()).toThrow(
      /WORKER_DEFAULT_CAPACITY/,
    );
  });
});

describe("resolveWorkerAgentClientConfig", () => {
  it("uses WORKER_AGENT_URL override for local worker-pool mode", () => {
    const config = resolveWorkerAgentClientConfig({
      worker: { tailscaleIp: "100.64.1.25" },
      hmacSecret: "secret",
      runtimeEnv: {
        WORKER_AGENT_URL: "http://127.0.0.1:4500",
      },
    });

    expect(config.baseUrl).toBe("http://127.0.0.1:4500");
  });

  it("can ignore WORKER_AGENT_URL for managed Hetzner workers", () => {
    const config = resolveWorkerAgentClientConfig({
      worker: { tailscaleIp: "100.64.1.25" },
      hmacSecret: "secret",
      runtimeEnv: {
        WORKER_AGENT_URL: "http://127.0.0.1:4500",
      },
      ignoreConfiguredAgentUrl: true,
    });

    expect(config.baseUrl).toBe("http://100.64.1.25:4500");
  });
});
