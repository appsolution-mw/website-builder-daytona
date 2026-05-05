import type { AgentProvider } from "../src/agent-provider";
import type { BrokerToHost } from "@wbd/protocol";
import { describe, expect, it, vi } from "vitest";

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
});
