import { describe, it, expect, afterAll } from "vitest";
import WebSocket from "ws";
import { createFakeClient } from "../fake";

describe("fake Daytona + file.list", () => {
  const daytona = createFakeClient();
  const spawnedIds: string[] = [];

  afterAll(async () => {
    for (const id of spawnedIds) await daytona.destroyProjectSandbox(id).catch(() => {});
  });

  it("file.list returns the project-template files after fake spawn", async () => {
    const info = await daytona.spawnProjectSandbox({
      projectId: "filelist-1",
      source: { type: "template" },
    });
    spawnedIds.push(info.sandboxId);

    const ws = new WebSocket(info.brokerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const reply = await new Promise<{ type: string; paths: string[] }>((resolve) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.send(JSON.stringify({ type: "file.list", requestId: "r1" }));
    });

    expect(reply.type).toBe("file.list.result");
    expect(reply.paths.length).toBeGreaterThan(0);
    expect(reply.paths).toContain("package.json");
    ws.close();
  });
});
