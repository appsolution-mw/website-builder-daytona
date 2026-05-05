import { afterEach, describe, expect, it, vi } from "vitest";

const requireCurrentUserFromRequestMock = vi.hoisted(() => vi.fn());
const requireAccessibleProjectMock = vi.hoisted(() => vi.fn());
const listProjectEventsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: requireCurrentUserFromRequestMock,
}));

vi.mock("@/lib/workspaces/access", () => ({
  requireAccessibleProject: requireAccessibleProjectMock,
}));

vi.mock("@/lib/agent-runs/events", () => ({
  listProjectEvents: listProjectEventsMock,
}));

import { GET } from "../route";

const USER = { id: "user-1" };
const PROJECT = { id: "project-1", ownerId: "owner-1", workspaceId: "workspace-1" };

function context(projectId = PROJECT.id): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: projectId }) };
}

describe("GET /api/projects/[id]/events", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replays project events after a non-negative cursor", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);
    listProjectEventsMock.mockResolvedValue([
      {
        id: "event-2",
        runId: "run-1",
        attemptId: null,
        projectId: PROJECT.id,
        sessionId: "session-1",
        sequence: 2,
        type: "STATUS",
        agentId: null,
        payload: { status: "RUNNING" },
        createdAt: "2026-05-05T10:00:00.000Z",
      },
    ]);

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT.id}/events?after=1`),
      context(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      events: [
        {
          id: "event-2",
          runId: "run-1",
          attemptId: null,
          projectId: PROJECT.id,
          sessionId: "session-1",
          sequence: 2,
          type: "STATUS",
          agentId: null,
          payload: { status: "RUNNING" },
          createdAt: "2026-05-05T10:00:00.000Z",
        },
      ],
    });
    expect(requireAccessibleProjectMock).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      userId: USER.id,
    });
    expect(listProjectEventsMock).toHaveBeenCalledWith({
      projectId: PROJECT.id,
      after: 1,
    });
  });

  it("rejects invalid event cursors", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockResolvedValue(PROJECT);

    const res = await GET(
      new Request(`http://localhost/api/projects/${PROJECT.id}/events?after=-1`),
      context(),
    );

    expect(res.status).toBe(400);
    expect(listProjectEventsMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the project is not accessible", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({ ok: true, user: USER });
    requireAccessibleProjectMock.mockRejectedValue(new Error("project_not_found"));

    const res = await GET(
      new Request("http://localhost/api/projects/missing/events?after=0"),
      context("missing"),
    );

    expect(res.status).toBe(404);
    expect(listProjectEventsMock).not.toHaveBeenCalled();
  });
});
