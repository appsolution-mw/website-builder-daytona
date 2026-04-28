import { afterEach, describe, expect, it } from "vitest";
import { codexSandboxModeFromEnv } from "../src/codex-runner";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("codex runner config", () => {
  it("uses danger-full-access by default to avoid nested bwrap sandboxing", () => {
    delete process.env.CODEX_SANDBOX_MODE;

    expect(codexSandboxModeFromEnv("CODEX_SANDBOX_MODE", "danger-full-access")).toBe(
      "danger-full-access",
    );
  });

  it("keeps explicit sandbox modes for hosts that support them", () => {
    process.env.CODEX_SANDBOX_MODE = "workspace-write";

    expect(codexSandboxModeFromEnv("CODEX_SANDBOX_MODE", "danger-full-access")).toBe(
      "workspace-write",
    );
  });

  it("ignores invalid sandbox modes", () => {
    process.env.CODEX_SANDBOX_MODE = "broken";

    expect(codexSandboxModeFromEnv("CODEX_SANDBOX_MODE", "danger-full-access")).toBe(
      "danger-full-access",
    );
  });
});
