import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("forwards readable attachmentPaths as multimodal local_image entries alongside the prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-runner-images-"));
    try {
      const path0 = join(dir, "0.png");
      const path1 = join(dir, "1.jpg");
      await writeFile(path0, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await writeFile(path1, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

      await runCodexTurn({
        projectId: "p1",
        sessionId: "session-codex-1",
        resumeSession: false,
        prompt: "What is in this picture?",
        turnId: "turn-1",
        attachmentPaths: [path0, path1],
        onEvent: () => {},
      });

      expect(runStreamedMock).toHaveBeenCalledTimes(1);
      const [input] = runStreamedMock.mock.calls[0] as [unknown];
      expect(Array.isArray(input)).toBe(true);
      const arr = input as Array<{ type: string; text?: string; path?: string }>;
      expect(arr).toHaveLength(3);
      expect(arr[0]).toMatchObject({ type: "text" });
      expect(arr[0]?.text).toContain("attached 2 images");
      expect(arr[0]?.text).toContain("What is in this picture?");
      expect(arr[1]).toEqual({ type: "local_image", path: path0 });
      expect(arr[2]).toEqual({ type: "local_image", path: path1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops attachmentPaths whose files are missing or empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-runner-images-"));
    try {
      const realPath = join(dir, "ok.png");
      const emptyPath = join(dir, "empty.png");
      const missingPath = join(dir, "missing.png");
      await writeFile(realPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await writeFile(emptyPath, Buffer.alloc(0));

      await runCodexTurn({
        projectId: "p1",
        sessionId: "session-codex-drop",
        resumeSession: false,
        prompt: "Look at this",
        turnId: "turn-drop",
        attachmentPaths: [realPath, emptyPath, missingPath],
        onEvent: () => {},
      });

      const [input] = runStreamedMock.mock.calls[0] as [unknown];
      const arr = input as Array<{ type: string; path?: string }>;
      expect(arr).toHaveLength(2);
      expect(arr[0]?.type).toBe("text");
      expect(arr[1]).toEqual({ type: "local_image", path: realPath });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("falls back to a plain string prompt when every attachment path is unreadable", async () => {
    await runCodexTurn({
      projectId: "p1",
      sessionId: "session-codex-4",
      resumeSession: false,
      prompt: "Plain text after dropping all",
      turnId: "turn-4",
      attachmentPaths: ["/does/not/exist/0.png", "/does/not/exist/1.png"],
      onEvent: () => {},
    });

    const [input] = runStreamedMock.mock.calls[0] as [unknown];
    expect(input).toBe("Plain text after dropping all");
  });
});
