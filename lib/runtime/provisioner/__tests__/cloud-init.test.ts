import { describe, expect, it } from "vitest";
import { redactCloudInit, renderWorkerCloudInit } from "../cloud-init";

describe("renderWorkerCloudInit", () => {
  const baseArgs: Parameters<typeof renderWorkerCloudInit>[0] = {
    workerId: "worker_123",
    workerAgentImage: "ghcr.io/acme/worker-agent:sha",
    workerAgentHmacSecret: "hmac-secret",
    tailscaleAuthKey: "tskey-auth",
    heartbeatUrl: "https://example.test/api/workers/heartbeat",
    sandboxImage: "ghcr.io/acme/sandbox:sha",
  };

  it("renders worker setup with required images, secrets, and environment", () => {
    const rendered = renderWorkerCloudInit(baseArgs);

    expect(rendered).toContain("tailscale up --auth-key tskey-auth");
    expect(rendered).toContain("docker pull ghcr.io/acme/worker-agent:sha");
    expect(rendered).toContain("docker pull ghcr.io/acme/sandbox:sha");
    expect(rendered).toContain("WORKER_ID=worker_123");
    expect(rendered).toContain("HMAC_SECRET=hmac-secret");
    expect(rendered).toContain("HOST_URL=https://example.test/api/workers/heartbeat");
    expect(rendered).toContain("--restart unless-stopped");

    const redacted = redactCloudInit(rendered);

    expect(redacted).not.toContain("tskey-auth");
    expect(redacted).not.toContain("hmac-secret");
    expect(redacted).toContain("tailscale up --auth-key [REDACTED]");
    expect(redacted).toContain("HMAC_SECRET=[REDACTED]");
  });

  it("renders docker run as one cloud-init runcmd item", () => {
    const rendered = renderWorkerCloudInit(baseArgs);
    const dockerRunItem = rendered
      .split("\n")
      .find((line) => line.includes("docker run -d --name worker-agent"));

    expect(rendered).not.toContain("\\\n      -v");
    expect(rendered).not.toContain("\\\n      -e");
    expect(dockerRunItem).toContain("-p 4500:4500");
    expect(dockerRunItem).toContain("-v /var/run/docker.sock:/var/run/docker.sock");
    expect(dockerRunItem).toContain("-e WORKER_ID=worker_123");
    expect(dockerRunItem).toContain("-e HMAC_SECRET=hmac-secret");
    expect(dockerRunItem).toContain("-e HOST_URL=https://example.test/api/workers/heartbeat");
    expect(dockerRunItem).toContain("-e SANDBOX_IMAGE=ghcr.io/acme/sandbox:sha");
  });

  it("rejects control characters that could break out of YAML runcmd lines", () => {
    for (const controlCharacter of ["\n", "\r", "\0"]) {
      expect(() =>
        renderWorkerCloudInit({
          ...baseArgs,
          workerId: `worker${controlCharacter}docker ps`,
        }),
      ).toThrow("workerId must not contain control characters");
    }
  });

  it("rejects other YAML line and control characters", () => {
    for (const separator of ["\x1b", "\x7f", "\u2028"]) {
      expect(() =>
        renderWorkerCloudInit({
          ...baseArgs,
          workerId: `worker${separator}docker ps`,
        }),
      ).toThrow("workerId must not contain control characters");
    }
  });

  it("keeps YAML-sensitive values safe while preserving shell quoting", () => {
    const rendered = renderWorkerCloudInit({
      ...baseArgs,
      workerId: "worker # 123: qa",
    });
    const dockerRunItem = rendered
      .split("\n")
      .find((line) => line.includes("docker run -d --name worker-agent"));

    expect(dockerRunItem).toContain("WORKER_ID=''worker # 123: qa''");
    expect(dockerRunItem?.trim()).toMatch(/^- 'docker run /);
  });

  it("redacts an entire shell-quoted HMAC value with env-like text", () => {
    const rendered = renderWorkerCloudInit({
      ...baseArgs,
      workerAgentHmacSecret: "hmac-secret -e HOST_URL=leaked-tail",
    });
    const redacted = redactCloudInit(rendered);

    expect(redacted).not.toContain("hmac-secret");
    expect(redacted).not.toContain("leaked-tail");
    expect(redacted).toContain("HMAC_SECRET=[REDACTED]");
    expect(redacted).toContain("-e HOST_URL=https://example.test/api/workers/heartbeat");
  });

  it("shell-quotes single quotes in input values", () => {
    const rendered = renderWorkerCloudInit({
      ...baseArgs,
      workerId: "worker'123",
      workerAgentHmacSecret: "hmac'secret",
      heartbeatUrl: "https://example.test/worker'123",
    });

    expect(rendered).toContain("WORKER_ID=''worker''\\''''123''");
    expect(rendered).toContain("HMAC_SECRET=''hmac''\\''''secret''");
    expect(rendered).toContain("HOST_URL=''https://example.test/worker''\\''''123''");
    expect(redactCloudInit(rendered)).not.toContain("hmac");
  });
});
