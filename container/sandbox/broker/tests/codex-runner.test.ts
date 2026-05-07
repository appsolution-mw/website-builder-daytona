import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runStreamedMock = vi.hoisted(() => vi.fn());
const startThreadMock = vi.hoisted(() => vi.fn());

vi.mock("@openai/codex-sdk", () => {
  return {
    Codex: class {
      startThread(...args: unknown[]) {
        return startThreadMock(...args);
      }
    },
  };
});

import { codexSandboxModeFromEnv, runCodexTurn } from "../src/codex-runner";

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

describe("runCodexTurn — multimodal input", () => {
  beforeEach(() => {
    runStreamedMock.mockReset();
    startThreadMock.mockReset();
    // A turn.completed event is enough to drive the stream loop to completion.
    async function* emitCompleted() {
      yield {
        type: "turn.completed" as const,
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      };
    }
    runStreamedMock.mockResolvedValue({ events: emitCompleted() });
    startThreadMock.mockReturnValue({ runStreamed: runStreamedMock });
    process.env.CODEX_API_KEY = "test-key";
  });

  it("forwards attachmentPaths as multimodal local_image entries alongside the prompt", async () => {
    await runCodexTurn({
      projectId: "p1",
      sessionId: "session-codex-1",
      resumeSession: false,
      prompt: "What is in this picture?",
      turnId: "turn-1",
      attachmentPaths: ["/abs/path/0.png", "/abs/path/1.jpg"],
      onEvent: () => {},
    });

    expect(runStreamedMock).toHaveBeenCalledTimes(1);
    const [input] = runStreamedMock.mock.calls[0] as [unknown];
    expect(Array.isArray(input)).toBe(true);
    expect(input).toEqual([
      { type: "text", text: "What is in this picture?" },
      { type: "local_image", path: "/abs/path/0.png" },
      { type: "local_image", path: "/abs/path/1.jpg" },
    ]);
  });

  it("falls back to a plain string prompt when no attachmentPaths are provided", async () => {
    await runCodexTurn({
      projectId: "p1",
      sessionId: "session-codex-2",
      resumeSession: false,
      prompt: "Just a text prompt",
      turnId: "turn-2",
      onEvent: () => {},
    });

    expect(runStreamedMock).toHaveBeenCalledTimes(1);
    const [input] = runStreamedMock.mock.calls[0] as [unknown];
    expect(input).toBe("Just a text prompt");
  });

  it("treats an empty attachmentPaths array the same as no attachments", async () => {
    await runCodexTurn({
      projectId: "p1",
      sessionId: "session-codex-3",
      resumeSession: false,
      prompt: "No images here",
      turnId: "turn-3",
      attachmentPaths: [],
      onEvent: () => {},
    });

    const [input] = runStreamedMock.mock.calls[0] as [unknown];
    expect(input).toBe("No images here");
  });
});
