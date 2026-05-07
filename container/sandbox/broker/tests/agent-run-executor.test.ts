import type { AgentProvider } from "../src/agent-provider";
import type { BrokerToHost, PromptImageAttachment } from "@wbd/protocol";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runTurnMock = vi.hoisted(() => vi.fn());
const createAgentProviderMock = vi.hoisted(() => vi.fn());

vi.mock("../src/agent-provider-factory", () => ({
  createAgentProvider: createAgentProviderMock,
}));

import { executeAgentRun } from "../src/agent-run-executor";

describe("executeAgentRun", () => {
  it("calls the selected provider with durable run metadata", async () => {
    createAgentProviderMock.mockReturnValue({
      runtime: "openhands",
      runTurn: runTurnMock,
    } satisfies AgentProvider);

    await executeAgentRun({
      projectId: "project-1",
      sessionId: "session-1",
      providerSessionId: "provider-session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      prompt: "Build it",
      runtime: "openhands",
      resumeSession: true,
      modelId: "openrouter:test/model",
      projectRoot: "/workspace/project",
      signal: new AbortController().signal,
      persistEvent: async () => undefined,
      broadcastEvent: () => undefined,
    });

    expect(createAgentProviderMock).toHaveBeenCalledWith({ runtime: "openhands" });
    expect(runTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionId: "provider-session-1",
      resumeSession: true,
      prompt: "Build it",
      turnId: "run-1",
      projectRoot: "/workspace/project",
      modelId: "openrouter:test/model",
      run: {
        runId: "run-1",
        attemptId: "attempt-1",
        conversationId: "provider-session-1",
        persistenceDir: "/workspace/project/.agent-artifacts/openhands/conversations",
      },
    }));
  });

  it("persists provider events before broadcasting them", async () => {
    const event: BrokerToHost = { type: "agent.chunk", turnId: "run-1", delta: "hello" };
    const order: string[] = [];
    createAgentProviderMock.mockReturnValue({
      runtime: "openai-codex",
      runTurn: async (opts) => {
        await opts.onEvent(event);
      },
    } satisfies AgentProvider);

    await executeAgentRun({
      projectId: "project-1",
      sessionId: "session-1",
      providerSessionId: "provider-session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      prompt: "Build it",
      runtime: "openai-codex",
      resumeSession: false,
      projectRoot: "/workspace/project",
      signal: new AbortController().signal,
      persistEvent: async () => {
        order.push("persist");
      },
      broadcastEvent: () => {
        order.push("broadcast");
      },
    });

    expect(order).toEqual(["persist", "broadcast"]);
  });

  describe("with image attachments", () => {
    let projectRoot: string;
    const attachment: PromptImageAttachment = {
      name: "pixel.png",
      // 1x1 transparent PNG
      dataBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      mimeType: "image/png",
    };

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), "agent-run-executor-"));
      runTurnMock.mockReset();
      createAgentProviderMock.mockReset();
    });

    afterEach(async () => {
      await rm(projectRoot, { recursive: true, force: true });
    });

    it("forwards openai-codex attachments as attachmentPaths and keeps the prompt clean", async () => {
      createAgentProviderMock.mockReturnValue({
        runtime: "openai-codex",
        runTurn: runTurnMock,
      } satisfies AgentProvider);

      await executeAgentRun({
        projectId: "project-1",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        runId: "run-codex-1",
        attemptId: "attempt-1",
        prompt: "Look at this",
        runtime: "openai-codex",
        resumeSession: false,
        attachments: [attachment],
        projectRoot,
        signal: new AbortController().signal,
        persistEvent: async () => undefined,
        broadcastEvent: () => undefined,
      });

      expect(runTurnMock).toHaveBeenCalledTimes(1);
      const call = runTurnMock.mock.calls[0]?.[0] as {
        prompt: string;
        attachmentPaths?: string[];
        attachments?: unknown;
      };

      // Prompt MUST stay clean — no "## Attached images" suffix, no @<path> bullet.
      expect(call.prompt).toBe("Look at this");
      expect(call.prompt).not.toMatch(/Attached images/i);
      expect(call.prompt).not.toMatch(/^\s*-\s*@/m);

      // Codex receives image paths via the dedicated multimodal field.
      expect(call.attachmentPaths).toBeDefined();
      expect(call.attachmentPaths).toHaveLength(1);
      const imagePath = call.attachmentPaths![0]!;
      expect(imagePath.startsWith(projectRoot)).toBe(true);
      expect(imagePath).toContain("/.agent-artifacts/chat-attachments/run-codex-1/");

      // The file actually exists on disk — verifies prepareDiskAttachments ran.
      const written = await readFile(imagePath);
      expect(written.length).toBeGreaterThan(0);

      // Codex must NOT receive the protocol `attachments` array — only paths.
      expect(call.attachments).toBeUndefined();
    });

    it("appends the @<path> suffix to the claude-code prompt and does not pass attachmentPaths", async () => {
      createAgentProviderMock.mockReturnValue({
        runtime: "claude-code",
        runTurn: runTurnMock,
      } satisfies AgentProvider);

      await executeAgentRun({
        projectId: "project-1",
        sessionId: "session-1",
        providerSessionId: "provider-session-1",
        runId: "run-claude-1",
        attemptId: "attempt-1",
        prompt: "Look at this",
        runtime: "claude-code",
        resumeSession: false,
        attachments: [attachment],
        projectRoot,
        signal: new AbortController().signal,
        persistEvent: async () => undefined,
        broadcastEvent: () => undefined,
      });

      const call = runTurnMock.mock.calls[0]?.[0] as {
        prompt: string;
        attachmentPaths?: string[];
        attachments?: unknown;
      };

      expect(call.prompt).toMatch(/^Look at this/);
      expect(call.prompt).toMatch(/## Attached images/);
      expect(call.prompt).toMatch(
        new RegExp(`- @${projectRoot}/.agent-artifacts/chat-attachments/run-claude-1/0\\.png`),
      );

      // Claude Code path must NOT use the codex-only attachmentPaths channel.
      expect(call.attachmentPaths).toBeUndefined();
    });
  });
});
