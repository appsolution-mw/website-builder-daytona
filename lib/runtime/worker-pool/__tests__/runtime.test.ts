import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../db/client";
import { RuntimeError } from "../../errors";
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

  it("fake agent records queue commands separately from create requests", async () => {
    const handles = createFakeAgentClient();

    await handles.client.drainProjectQueue("sandbox-1", "project-1");
    await handles.client.cancelProjectRun("sandbox-1", "project-1", "run-1");

    expect(handles.requests()).toEqual([]);
    expect(handles.commandRequests()).toEqual([
      { type: "queue.drain", sandboxId: "sandbox-1", projectId: "project-1" },
      {
        type: "run.cancel",
        sandboxId: "sandbox-1",
        projectId: "project-1",
        runId: "run-1",
      },
    ]);
  });

  it("provisions a worker on first spawn and creates the sandbox", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();

    const info = await r.spawnProjectSandbox({ projectId, source: { type: "template" } });

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

  it("uses project route hook preview URLs after sandbox creation", async () => {
    const handles = createFakeAgentClient();
    const appliedRoutes: Array<{
      projectId: string;
      sandboxId: string;
      workerId: string;
      previewPort: number;
    }> = [];
    const r = createWorkerPoolRuntime({
      ...RUNTIME_ARGS(handles),
      projectRouteFor: async ({ projectId, sandboxId, worker, previewPort }) => {
        appliedRoutes.push({ projectId, sandboxId, workerId: worker.id, previewPort });
        return { previewUrl: `https://${projectId}.example.com` };
      },
    });
    const projectId = await project();

    const info = await r.spawnProjectSandbox({ projectId, source: { type: "template" } });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });

    expect(info.previewUrl).toBe(`https://${projectId}.example.com`);
    expect(appliedRoutes).toEqual([
      {
        projectId,
        sandboxId: ws.id,
        workerId: ws.workerId,
        previewPort: ws.previewPort,
      },
    ]);
  });

  it("cleans up sandbox state when project route hook fails", async () => {
    const handles = createFakeAgentClient();
    const deletedRoutes: Array<{ projectId: string; sandboxId: string }> = [];
    const r = createWorkerPoolRuntime({
      ...RUNTIME_ARGS(handles),
      projectRouteFor: async () => {
        throw new Error("caddy unavailable");
      },
      deleteProjectRouteFor: async (args) => {
        deletedRoutes.push(args);
      },
    });
    const projectId = await project();

    await expect(r.spawnProjectSandbox({
      projectId,
      source: { type: "template" },
    })).rejects.toThrow("caddy unavailable");

    expect(await prisma.workerSandbox.count()).toBe(0);
    expect(await prisma.sandboxToken.count()).toBe(0);
    expect(handles.list()).toHaveLength(0);
    expect(deletedRoutes).toHaveLength(1);
    expect(deletedRoutes[0]?.projectId).toBe(projectId);
  });

  it("throws NO_WORKER_CAPACITY when provisioning is disabled and no worker is available", async () => {
    const handles = createFakeAgentClient();
    const provisioner = createFakeProvisioner();
    const r = createWorkerPoolRuntime({
      scheduler: {
        pickWorker: async () => null,
      },
      provisioner,
      agentClientFor: () => handles.client,
      sandboxImage: "wbd/sandbox:dev",
      autoProvisionWhenFull: false,
    });
    const projectId = await project();

    await expect(r.spawnProjectSandbox({
      projectId,
      source: { type: "template" },
    })).rejects.toEqual(
      new RuntimeError(
        "NO_WORKER_CAPACITY",
        "No ready worker has a free project slot",
      ),
    );
    expect(await prisma.worker.count()).toBe(0);
    expect(handles.requests()).toEqual([]);
  });

  it("reserves worker slots atomically under concurrent spawns", async () => {
    const handles = createFakeAgentClient();
    const worker = {
      id: "worker-one-slot",
      tailscaleHostname: "worker-one-slot",
      tailscaleIp: "100.64.1.25",
      provider: "fake",
      providerVmId: "vm-worker-one-slot",
      region: "local",
      capacity: 1,
      status: "READY" as const,
    };
    await prisma.worker.create({
      data: {
        ...worker,
        name: worker.id,
      },
    });
    const r = createWorkerPoolRuntime({
      scheduler: { pickWorker: async () => worker },
      provisioner: createFakeProvisioner(),
      agentClientFor: () => handles.client,
      sandboxImage: "wbd/sandbox:dev",
      autoProvisionWhenFull: false,
    });
    const [firstProjectId, secondProjectId] = await Promise.all([project(), project()]);

    const results = await Promise.allSettled([
      r.spawnProjectSandbox({ projectId: firstProjectId, source: { type: "template" } }),
      r.spawnProjectSandbox({ projectId: secondProjectId, source: { type: "template" } }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status !== "rejected") {
      throw new Error("expected one spawn to reject");
    }
    expect(rejected.reason).toEqual(
      new RuntimeError(
        "NO_WORKER_CAPACITY",
        "No ready worker has a free project slot",
      ),
    );
    expect(await prisma.workerSandbox.count({ where: { workerId: worker.id } })).toBe(1);
    expect(handles.requests()).toHaveLength(1);
  });

  it("reuses an existing READY worker on subsequent spawns", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));

    await r.spawnProjectSandbox({ projectId: await project(), source: { type: "template" } });
    await r.spawnProjectSandbox({ projectId: await project(), source: { type: "template" } });

    const workers = await prisma.worker.count();
    expect(workers).toBe(1);
    const sandboxes = await prisma.workerSandbox.count();
    expect(sandboxes).toBe(2);
  });

  it("encodes project dotenv content into the worker-agent sandbox env", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectEnvContent = "PUBLIC_NAME=Workspace\nPRIVATE_TOKEN=s3cr3t\n";
    const spawnArgs = {
      projectId: await project(),
      source: { type: "template" as const },
      projectEnvContent,
    };

    await r.spawnProjectSandbox(spawnArgs);

    expect(handles.requests()).toHaveLength(1);
    expect(handles.requests()[0]?.env.PROJECT_ENV_B64).toBe(
      Buffer.from(projectEnvContent, "utf8").toString("base64"),
    );
  });

  it("encodes managed OpenHands files into the worker-agent sandbox env", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const openhandsFiles = [
      { path: "AGENTS.md", content: "# Project instructions\n" },
      { path: ".agents/skills/copy/SKILL.md", content: "---\nname: copy\n---\n" },
    ];

    await r.spawnProjectSandbox({
      projectId: await project(),
      source: { type: "template" },
      openhandsFiles,
    });

    expect(handles.requests()).toHaveLength(1);
    expect(handles.requests()[0]?.env.OPENHANDS_FILES_B64).toBe(
      Buffer.from(JSON.stringify(openhandsFiles), "utf8").toString("base64"),
    );
  });

  it("forwards GitHub repository source env to the worker-agent sandbox", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));

    await r.spawnProjectSandbox({
      projectId: await project(),
      source: {
        type: "github",
        installationId: "123",
        owner: "octo",
        repo: "hello-world",
        branch: "main",
        commitSha: "abc123",
        token: "installation-token",
      },
    });

    expect(handles.requests()[0]?.env).toMatchObject({
      PROJECT_SOURCE_TYPE: "github",
      GITHUB_REPO_OWNER: "octo",
      GITHUB_REPO_NAME: "hello-world",
      GITHUB_REPO_BRANCH: "main",
      GITHUB_REPO_COMMIT_SHA: "abc123",
      GITHUB_REPO_TOKEN: "installation-token",
    });
  });

  it("keeps project GitHub source env ahead of legacy global clone env", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime({
      ...RUNTIME_ARGS(handles),
      brokerEnv: () => ({
        GITHUB_REPO_OWNER: "legacy-owner",
        GITHUB_REPO_NAME: "legacy-repo",
      }),
    });

    await r.spawnProjectSandbox({
      projectId: await project(),
      source: {
        type: "github",
        installationId: "123",
        owner: "project-owner",
        repo: "project-repo",
        branch: "main",
        token: "installation-token",
      },
    });

    expect(handles.requests()[0]?.env).toMatchObject({
      GITHUB_REPO_OWNER: "project-owner",
      GITHUB_REPO_NAME: "project-repo",
    });
  });

  it("omits project dotenv env when content is empty", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const spawnArgs = {
      projectId: await project(),
      source: { type: "template" as const },
      projectEnvContent: "",
    };

    await r.spawnProjectSandbox(spawnArgs);

    expect(handles.requests()[0]?.env).not.toHaveProperty("PROJECT_ENV_B64");
  });

  it("destroyProjectSandbox removes container, token, and reservation row", async () => {
    const handles = createFakeAgentClient();
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    await r.spawnProjectSandbox({ projectId, source: { type: "template" } });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });

    await r.destroyProjectSandbox(ws.id);

    const after = await prisma.workerSandbox.findUnique({ where: { id: ws.id } });
    expect(after).toBeNull();
    const tok = await prisma.sandboxToken.findFirst({ where: { sandboxId: ws.id } });
    expect(tok).toBeNull();
    expect(handles.list()).toHaveLength(0);

    await expect(r.spawnProjectSandbox({ projectId, source: { type: "template" } })).resolves.toBeDefined();
  });

  it("destroyProjectSandbox deletes project routes idempotently", async () => {
    const handles = createFakeAgentClient();
    const deletedRoutes: Array<{ projectId: string; sandboxId: string }> = [];
    const r = createWorkerPoolRuntime({
      ...RUNTIME_ARGS(handles),
      deleteProjectRouteFor: async (args) => {
        deletedRoutes.push(args);
      },
    });
    const projectId = await project();
    await r.spawnProjectSandbox({ projectId, source: { type: "template" } });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });

    await r.destroyProjectSandbox(ws.id);

    expect(deletedRoutes).toEqual([{ projectId, sandboxId: ws.id }]);
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
    await r.spawnProjectSandbox({ projectId, source: { type: "template" } });
    const ws = await prisma.workerSandbox.findFirstOrThrow({ where: { projectId } });
    expect(await r.getSandboxStatus(ws.id)).toBe("running");
  });

  it("propagates AgentError when agent returns image-not-found", async () => {
    const handles = createFakeAgentClient();
    handles.failNext(422, "image-not-found");
    const r = createWorkerPoolRuntime(RUNTIME_ARGS(handles));
    const projectId = await project();
    await expect(r.spawnProjectSandbox({
      projectId, source: { type: "template" },
    })).rejects.toThrow(/image-not-found/);
    // No DB rows must remain
    const ws = await prisma.workerSandbox.count();
    expect(ws).toBe(0);
  });
});
