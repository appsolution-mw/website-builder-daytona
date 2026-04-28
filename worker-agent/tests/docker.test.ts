import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Docker from "dockerode";
import { createDockerClient, type SandboxSpec } from "../src/docker.js";

describe("docker wrapper", () => {
  const docker = new Docker();
  const client = createDockerClient({ docker, portRange: { min: 33000, max: 33099 } });
  const created: string[] = [];

  // Pre-pull a tiny image we use as the sandbox stand-in for these tests
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      docker.pull("alpine:3.20", (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
      });
    });
  });

  afterAll(async () => {
    for (const id of created) {
      try {
        await docker.getContainer(id).remove({ force: true });
      } catch { /* ignore */ }
    }
  });

  function spec(suffix: string): SandboxSpec {
    return {
      sandboxId: `test-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      projectId: `proj-${suffix}`,
      image: "alpine:3.20",
      env: { TEST: "1" },
      // alpine sleeps so the container stays "running"
      command: ["sh", "-c", "sleep 60"],
      // ports we don't actually need to bind for a sleep container, but the
      // wrapper still publishes brokerPort/previewPort against /tcp inside.
      brokerContainerPort: 4000,
      previewContainerPort: 3000,
    };
  }

  it("createSandbox starts a container and returns assigned ports", async () => {
    const s = spec("a");
    const r = await client.createSandbox(s);
    created.push(r.containerId);
    expect(r.containerId).toMatch(/^[a-f0-9]{12,64}$/);
    expect(r.brokerPort).toBeGreaterThanOrEqual(33000);
    expect(r.previewPort).toBeGreaterThanOrEqual(33000);
    expect(r.brokerPort).not.toBe(r.previewPort);
    expect(r.status).toBe("spawning");
  });

  it("getStatus returns 'running' shortly after start", async () => {
    const s = spec("b");
    const r = await client.createSandbox(s);
    created.push(r.containerId);
    // poll up to 5s
    let status = "spawning";
    for (let i = 0; i < 50; i++) {
      const got = await client.getStatus(s.sandboxId);
      status = got.status;
      if (status === "running") break;
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(status).toBe("running");
  });

  it("listSandboxes returns containers with our label", async () => {
    const s = spec("c");
    const r = await client.createSandbox(s);
    created.push(r.containerId);
    const list = await client.listSandboxes();
    expect(list.some((x) => x.sandboxId === s.sandboxId)).toBe(true);
  });

  it("destroySandbox stops + removes the container", async () => {
    const s = spec("d");
    const r = await client.createSandbox(s);
    await client.destroySandbox(s.sandboxId);
    // container should be gone
    const got = await client.getStatus(s.sandboxId);
    expect(got.status).toBe("gone");
  });

  it("destroySandbox is idempotent for unknown ids", async () => {
    await expect(client.destroySandbox("does-not-exist")).resolves.toBeUndefined();
  });
});
