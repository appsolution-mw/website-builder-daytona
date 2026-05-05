import { afterEach, describe, expect, it, vi } from "vitest";

const requireCurrentUserFromRequestMock = vi.hoisted(() => vi.fn());
const requireAccessibleProjectMock = vi.hoisted(() => vi.fn());
const enqueueAgentRunMock = vi.hoisted(() => vi.fn());
const retryAgentRunMock = vi.hoisted(() => vi.fn());
const skipAgentRunMock = vi.hoisted(() => vi.fn());
const requestProjectQueueDrainMock = vi.hoisted(() => vi.fn());
const requestProjectRunCancelMock = vi.hoisted(() => vi.fn());
const sessionFindFirstMock = vi.hoisted(() => vi.fn());
const agentRunFindManyMock = vi.hoisted(() => vi.fn());
const agentRunFindFirstMock = vi.hoisted(() => vi.fn());
const projectQueueStateFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: requireCurrentUserFromRequestMock,
}));

vi.mock("@/lib/workspaces/access", () => ({
  requireAccessibleProject: requireAccessibleProjectMock,
}));

vi.mock("@/lib/agent-runs/queue", () => ({
  enqueueAgentRun: enqueueAgentRunMock,
  retryAgentRun: retryAgentRunMock,
  skipAgentRun: skipAgentRunMock,
}));

vi.mock("@/lib/agent-runs/executor-client", () => ({
  requestProjectQueueDrain: requestProjectQueueDrainMock,
  requestProjectRunCancel: requestProjectRunCancelMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: {
      findFirst: sessionFindFirstMock,
    },
    agentRun: {
      findMany: agentRunFindManyMock,
      findFirst: agentRunFindFirstMock,
    },
    projectQueueState: {
      findUnique: projectQueueStateFindUniqueMock,
    },
  },
}));

import { GET, POST } from "../route";
import { POST as retryPOST } from "../[runId]/retry/route";
import { POST as skipPOST } from "../[runId]/skip/route";
import { POST as cancelPOST } from "../[runId]/cancel/route";

const USER = { id: "user-1" };
const PROJECT = { id: "project-1", ownerId: "owner-1", workspaceId: "workspace-1" };

function context(projectId = PROJECT.id): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: projectId }) };
}

function runContext(runId = "run-1"): { params: Promise<{ id: string; runId: string }> } {
  return { params: Promise.resolve({ id: PROJECT.id, runId }) };
}

function postRequest(body: unknown): Request {
  return new Request(`http://localhost/api/projects/${PROJECT.id}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/projects/[id]/runs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a validated run and triggers the project queue drain", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    sessionFindFirstMock.mockResolvedValue({ id: "session-1" });
    enqueueAgentRunMock.mockResolvedValue({
      runId: "run-1",
      messageId: "message-1",
      queueSequence: 7,
    });

    const res = await POST(postRequest({
      sessionId: "session-1",
      prompt: " Build this ",
      runtime: "openai-codex",
      providerSessionId: "provider-session-1",
      modelId: "gpt-test",
    }), context());

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      runId: "run-1",
      messageId: "message-1",
      queueSequence: 7,
    });
    expect(requireCurrentUserFromRequestMock).toHaveBeenCalledOnce();
    expect(requireAccessibleProjectMock).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      userId: USER.id,
    });
    expect(sessionFindFirstMock).toHaveBeenCalledWith({
      where: { id: "session-1", projectId: PROJECT.id },
      select: { id: true },
    });
    expect(enqueueAgentRunMock).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      sessionId: "session-1",
      userId: USER.id,
      prompt: "Build this",
      runtime: "openai-codex",
      providerSessionId: "provider-session-1",
      modelId: "gpt-test",
    });
    expect(requestProjectQueueDrainMock).toHaveBeenCalledWith(PROJECT.id);
  });

  it("rejects invalid enqueue payloads before mutating state", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);

    const res = await POST(postRequest({
      sessionId: "session-1",
      prompt: "   ",
      runtime: "not-a-runtime",
      providerSessionId: 123,
    }), context());

    expect(res.status).toBe(400);
    expect(sessionFindFirstMock).not.toHaveBeenCalled();
    expect(enqueueAgentRunMock).not.toHaveBeenCalled();
    expect(requestProjectQueueDrainMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the session is not part of the accessible project", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    sessionFindFirstMock.mockResolvedValue(null);

    const res = await POST(postRequest({
      sessionId: "session-1",
      prompt: "Build this",
      runtime: "openai-codex",
      providerSessionId: "provider-session-1",
    }), context());

    expect(res.status).toBe(404);
    expect(enqueueAgentRunMock).not.toHaveBeenCalled();
  });

  it("lists queued, active, and blocked runs with serialized runtime and queue state", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    projectQueueStateFindUniqueMock.mockResolvedValue({
      state: "BLOCKED",
      activeRunId: null,
      blockedRunId: "run-failed",
      blockedAt: new Date("2026-05-05T10:02:00.000Z"),
      updatedAt: new Date("2026-05-05T10:03:00.000Z"),
    });
    agentRunFindManyMock.mockResolvedValue([
      {
        id: "run-queued",
        status: "QUEUED",
        queueSequence: 1,
        sessionId: "session-1",
        userMessageId: "message-1",
        createdById: USER.id,
        runtime: "OPENAI_CODEX",
        modelId: "gpt-test",
        queuedAt: new Date("2026-05-05T10:00:00.000Z"),
        startedAt: null,
        finishedAt: null,
        blockedReason: null,
      },
      {
        id: "run-failed",
        status: "FAILED",
        queueSequence: 2,
        sessionId: "session-1",
        userMessageId: "message-2",
        createdById: USER.id,
        runtime: "CLAUDE_CODE",
        modelId: null,
        queuedAt: new Date("2026-05-05T10:01:00.000Z"),
        startedAt: new Date("2026-05-05T10:01:30.000Z"),
        finishedAt: new Date("2026-05-05T10:02:00.000Z"),
        blockedReason: "Worker failed",
      },
    ]);

    const res = await GET(new Request(`http://localhost/api/projects/${PROJECT.id}/runs`), context());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      runs: [
        {
          id: "run-queued",
          status: "QUEUED",
          queueSequence: 1,
          sessionId: "session-1",
          userMessageId: "message-1",
          createdById: USER.id,
          runtime: "openai-codex",
          modelId: "gpt-test",
          queuedAt: "2026-05-05T10:00:00.000Z",
          startedAt: null,
          finishedAt: null,
          blockedReason: null,
        },
        {
          id: "run-failed",
          status: "FAILED",
          queueSequence: 2,
          sessionId: "session-1",
          userMessageId: "message-2",
          createdById: USER.id,
          runtime: "claude-code",
          modelId: null,
          queuedAt: "2026-05-05T10:01:00.000Z",
          startedAt: "2026-05-05T10:01:30.000Z",
          finishedAt: "2026-05-05T10:02:00.000Z",
          blockedReason: "Worker failed",
        },
      ],
      queueState: {
        state: "BLOCKED",
        activeRunId: null,
        blockedRunId: "run-failed",
        blockedAt: "2026-05-05T10:02:00.000Z",
        updatedAt: "2026-05-05T10:03:00.000Z",
      },
    });
    expect(agentRunFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: PROJECT.id,
        OR: [
          { status: { in: ["QUEUED", "RUNNING"] } },
          { id: { in: ["run-failed"] } },
        ],
      },
    }));
  });

  it("retries a failed project run and triggers the drain", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    agentRunFindFirstMock.mockResolvedValue({ id: "run-1", status: "FAILED" });

    const res = await retryPOST(new Request("http://localhost/api/projects/project-1/runs/run-1/retry", {
      method: "POST",
    }), runContext());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(retryAgentRunMock).toHaveBeenCalledWith({ projectId: PROJECT.id, runId: "run-1" });
    expect(requestProjectQueueDrainMock).toHaveBeenCalledWith(PROJECT.id);
  });

  it("rejects retry for a non-terminal run", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    agentRunFindFirstMock.mockResolvedValue({ id: "run-1", status: "RUNNING" });

    const res = await retryPOST(new Request("http://localhost/api/projects/project-1/runs/run-1/retry", {
      method: "POST",
    }), runContext());

    expect(res.status).toBe(400);
    expect(retryAgentRunMock).not.toHaveBeenCalled();
    expect(requestProjectQueueDrainMock).not.toHaveBeenCalled();
  });

  it("returns 400 when retrying a terminal run that is not blocking the queue", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    agentRunFindFirstMock.mockResolvedValue({ id: "run-1", status: "FAILED" });
    retryAgentRunMock.mockRejectedValue(new Error("Project queue is not blocked by run"));

    const res = await retryPOST(new Request("http://localhost/api/projects/project-1/runs/run-1/retry", {
      method: "POST",
    }), runContext());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "run is not blocking the project queue",
    });
    expect(requestProjectQueueDrainMock).not.toHaveBeenCalled();
  });

  it("skips a blocking run and triggers the drain", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    agentRunFindFirstMock.mockResolvedValue({ id: "run-1", status: "FAILED" });

    const res = await skipPOST(new Request("http://localhost/api/projects/project-1/runs/run-1/skip", {
      method: "POST",
    }), runContext());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(skipAgentRunMock).toHaveBeenCalledWith({ projectId: PROJECT.id, runId: "run-1" });
    expect(requestProjectQueueDrainMock).toHaveBeenCalledWith(PROJECT.id);
  });

  it("requests durable cancellation for a project run", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    agentRunFindFirstMock.mockResolvedValue({ id: "run-1", status: "RUNNING" });

    const res = await cancelPOST(new Request("http://localhost/api/projects/project-1/runs/run-1/cancel", {
      method: "POST",
    }), runContext());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requestProjectRunCancelMock).toHaveBeenCalledWith(PROJECT.id, "run-1");
  });
});
