import { describe, it, expect, afterAll } from "vitest";
import WebSocket from "ws";
import { createFakeClient } from "../fake";
import { startProxy, type ProxyHandle } from "../../../../ws-proxy/src/index";

describe("fake Daytona + ws-proxy + broker agent.prompt wire-up", () => {
  let proxy: ProxyHandle | undefined;
  const daytona = createFakeClient();
  const spawnedIds: string[] = [];

  afterAll(async () => {
    await proxy?.close();
    for (const id of spawnedIds) await daytona.destroyProjectSandbox(id).catch(() => {});
  });

  it("agent.prompt against fake broker (which has no claude) replies with agent.error", async () => {
    const info = await daytona.spawnProjectSandbox({
      projectId: "agent-integration-1",
      source: { type: "template" },
    });
    spawnedIds.push(info.sandboxId);

    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: async () => info.brokerUrl,
    });

    const ws = new WebSocket(`ws://localhost:${proxy.port}/p/agent-integration-1`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const events: unknown[] = [];
    ws.on("message", (d) => events.push(JSON.parse(d.toString())));

    ws.send(JSON.stringify({
      type: "agent.prompt",
      prompt: "hello",
      turnId: "t-e2e",
      runtime: "claude-code",
      sessionId: "chat-e2e",
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      resumeSession: false,
    }));

    // Wait up to 3s for the runner to emit agent.error (claude binary absent).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const hit = events.find(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          (e as { type?: string }).type === "agent.error" &&
          (e as { turnId?: string }).turnId === "t-e2e",
      );
      if (hit) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const errorEvent = events.find(
      (e): e is { type: "agent.error"; turnId: string; message: string } =>
        typeof e === "object" &&
        e !== null &&
        (e as { type?: string }).type === "agent.error" &&
        (e as { turnId?: string }).turnId === "t-e2e",
    );
    expect(errorEvent).toBeDefined();
    ws.close();
  });
});
