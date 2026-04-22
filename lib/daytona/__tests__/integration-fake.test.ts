import { describe, it, expect, afterAll } from "vitest";
import WebSocket from "ws";
import { createFakeClient } from "../fake";
import { startProxy, type ProxyHandle } from "../../../ws-proxy/src/index";

describe("fake Daytona + ws-proxy integration", () => {
  let proxy: ProxyHandle | undefined;
  const daytona = createFakeClient();
  const spawnedIds: string[] = [];

  afterAll(async () => {
    await proxy?.close();
    for (const id of spawnedIds) await daytona.destroyProjectSandbox(id).catch(() => {});
  });

  it("routes ping via proxy → fake-broker → pong with matching nonce", async () => {
    const info = await daytona.spawnProjectSandbox({
      projectId: "integration-1",
      cloneToken: "",
      repoOwner: "",
      repoName: "",
    });
    spawnedIds.push(info.sandboxId);

    proxy = await startProxy({
      port: 0,
      resolveBrokerUrl: async () => info.brokerUrl,
    });

    const ws = new WebSocket(`ws://localhost:${proxy.port}/p/integration-1`);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once("open", () => ws.send(JSON.stringify({ type: "ping", nonce: "z" })));
      ws.once("message", (d) => resolve(d.toString()));
      ws.once("error", reject);
    });
    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "z" });
    ws.close();
  });
});
