import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";
import { createFakeClient } from "../fake";
import type { DaytonaClient } from "../types";

describe("fake daytona client", () => {
  let client: DaytonaClient;
  const spawnedIds: string[] = [];

  afterEach(async () => {
    for (const id of spawnedIds) {
      await client?.destroyProjectSandbox(id).catch(() => {});
    }
    spawnedIds.length = 0;
  });

  it("spawns a local broker reachable at brokerUrl that echoes ping→pong", async () => {
    client = createFakeClient();
    const info = await client.spawnProjectSandbox({
      projectId: "p1",
      cloneToken: "unused",
      repoOwner: "u",
      repoName: "r",
    });
    spawnedIds.push(info.sandboxId);

    expect(info.brokerUrl).toMatch(/^ws:\/\/localhost:\d+$/);
    expect(info.previewUrl).toMatch(/^http:\/\//);

    const preview = await fetch(info.previewUrl);
    expect(preview.ok).toBe(true);
    expect(await preview.text()).toContain("Hello from project p1");

    const ws = new WebSocket(info.brokerUrl);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once("open", () => ws.send(JSON.stringify({ type: "ping", nonce: "x" })));
      ws.once("message", (d) => resolve(d.toString()));
      ws.once("error", reject);
    });
    expect(JSON.parse(reply)).toEqual({ type: "pong", nonce: "x" });
    ws.close();
  });

  it("reports running status after spawn, destroyed after delete", async () => {
    client = createFakeClient();
    const info = await client.spawnProjectSandbox({
      projectId: "p2",
      cloneToken: "",
      repoOwner: "",
      repoName: "",
    });
    spawnedIds.push(info.sandboxId);

    expect(await client.getSandboxStatus(info.sandboxId)).toBe("running");

    await client.destroyProjectSandbox(info.sandboxId);
    expect(await client.getSandboxStatus(info.sandboxId)).toBe("destroyed");
  });

  it("writes project dotenv content into the fake project root", async () => {
    client = createFakeClient();
    const projectEnvContent = "NEXT_PUBLIC_LABEL=Fake\nSECRET_VALUE=hidden\n";
    const spawnArgs = {
      projectId: "p3",
      cloneToken: "unused",
      repoOwner: "u",
      repoName: "r",
      projectEnvContent,
    };
    const info = await client.spawnProjectSandbox(spawnArgs);
    spawnedIds.push(info.sandboxId);

    const ws = new WebSocket(info.brokerUrl);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once("open", () => ws.send(JSON.stringify({ type: "file.read", requestId: "env", path: ".env" })));
      ws.once("message", (d) => resolve(d.toString()));
      ws.once("error", reject);
    });
    ws.close();

    expect(JSON.parse(reply)).toEqual({
      type: "file.content",
      requestId: "env",
      path: ".env",
      content: projectEnvContent,
    });
  });

  it("destroy is idempotent", async () => {
    client = createFakeClient();
    await client.destroyProjectSandbox("never-existed");
    // should not throw
  });
});
