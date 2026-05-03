import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../db/client";
import { createFakeProvisioner } from "../../provisioner/fake";
import { createSimpleScheduler } from "../../scheduler/simple";
import { createFakeAgentClient } from "../fake-agent-client";
import { createWorkerPoolRuntime } from "../runtime";

const RUNTIME_ARGS = (handles: ReturnType<typeof createFakeAgentClient>) => ({
  scheduler: createSimpleScheduler(),
  provisioner: createFakeProvisioner(),
  agentClientFor: () => handles.client,
  sandboxImage: "wbd/sandbox:dev",
});

async function project(): Promise<string> {
  // Project.ownerId is non-nullable with no default; create a minimal User first.
  const userId = "test-user-" + Math.random().toString(36).slice(2, 8);
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email: `${userId}@test.local` },
    update: {},
  });
  const p = await prisma.project.create({
    data: {
      name: "test-" + Math.random().toString(36).slice(2, 8),
      ownerId: userId,
    },
  });
  return p.id;
}

describe("WorkerPoolRuntime", () => {
  beforeEach(async () => {
    await prisma.sandboxToken.deleteMany({});
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { startsWith: "test-user-" } } });
  });
  afterEach(async () => {
    await prisma.sandboxToken.deleteMany({});
    await prisma.workerSandbox.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { startsWith: "test-user-" } } });
  });

  it("provisions a worker on first spawn and creates the sandbox", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();

    const info = await r.spawnProjectSandbox({
      projectId, cloneToken: "x", repoOwner: "x", repoName: "x",
    });

    // tailscaleIp is provider-specific (FakeProvisioner picks a 100.64.x.y CGNAT
    // address). Just assert the URL shape and that the token is embedded.
    expect(info.brokerUrl).toMatch(/^ws:\/\/[\d.]+:\d+\/\?token=[a-f0-9]{64}$/);
    expect(info.previewUrl).toMatch(/^http:\/\/[\d.]+:\d+$/);

    const ws = await prisma.workerSandbox.findFirst({ where: { projectId } });
    expect(ws?.status).toBe("SPAWNING");

    const tok = await prisma.sandboxToken.findFirst({ where: { sandboxId: ws!.id } });
    expect(tok?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(info.brokerUrl).toContain(tok!.token);
  });

  it("reuses an existing READY worker on subsequent spawns", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));

    await r.spawnProjectSandbox({ projectId: await project(), cloneToken: "x", repoOwner: "x", repoName: "x" });
    await r.spawnProjectSandbox({ projectId: await project(), cloneToken: "x", repoOwner: "x", repoName: "x" });

    const workers = await prisma.worker.count();
    expect(workers).toBe(1);
    const sandboxes = await prisma.workerSandbox.count();
    expect(sandboxes).toBe(2);
  });

  it("encodes project dotenv content into the worker-agent sandbox env", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectEnvContent = "PUBLIC_NAME=Daytona\nPRIVATE_TOKEN=s3cr3t\n";
    const spawnArgs = {
      projectId: await project(),
      cloneToken: "x",
      repoOwner: "x",
      repoName: "x",
      projectEnvContent,
    };

    await r.spawnProjectSandbox(spawnArgs);

    expect(handles.requests()).toHaveLength(1);
    expect(handles.requests()[0]?.env.PROJECT_ENV_B64).toBe(
      Buffer.from(projectEnvContent, "utf8").toString("base64"),
    );
  });

  it("omits project dotenv env when content is empty", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const spawnArgs = {
      projectId: await project(),
      cloneToken: "x",
      repoOwner: "x",
      repoName: "x",
      projectEnvContent: "",
    };

    await r.spawnProjectSandbox(spawnArgs);

    expect(handles.requests()[0]?.env).not.toHaveProperty("PROJECT_ENV_B64");
  });

  it("destroyProjectSandbox removes container + token, marks DESTROYED", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    await r.spawnProjectSandbox({ projectId, cloneToken: "x", repoOwner: "x", repoName: "x" });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });

    await r.destroyProjectSandbox(ws.id);

    const after = await prisma.workerSandbox.findUnique({ where: { id: ws.id } });
    expect(after?.status).toBe("DESTROYED");
    const tok = await prisma.sandboxToken.findFirst({ where: { sandboxId: ws.id } });
    expect(tok).toBeNull();
    expect(handles.list()).toHaveLength(0);
  });

  it("destroyProjectSandbox is idempotent for unknown ids", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    await expect(r.destroyProjectSandbox("nope")).resolves.toBeUndefined();
  });

  it("getSandboxStatus maps agent status to runtime status", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    await r.spawnProjectSandbox({ projectId, cloneToken: "x", repoOwner: "x", repoName: "x" });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });
    expect(await r.getSandboxStatus(ws.id)).toBe("running");
  });

  it("propagates AgentError when agent returns image-not-found", async () => {
    const handles = createFakeAgentClient();
    handles.failNext(422, "image-not-found");
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    await expect(r.spawnProjectSandbox({
      projectId, cloneToken: "x", repoOwner: "x", repoName: "x",
    })).rejects.toThrow(/image-not-found/);
    // No DB rows must remain
    const ws = await prisma.workerSandbox.count();
    expect(ws).toBe(0);
  });
});
