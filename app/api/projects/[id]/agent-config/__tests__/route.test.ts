import { afterEach, describe, expect, it, vi } from "vitest";

const requireCurrentUserFromRequestMock = vi.hoisted(() => vi.fn());
const projectFindFirstMock = vi.hoisted(() => vi.fn());
const projectAgentConfigUpsertMock = vi.hoisted(() => vi.fn());
const agentSkillEnablementCreateMock = vi.hoisted(() => vi.fn());
const agentDefinitionEnablementCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: requireCurrentUserFromRequestMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findFirst: projectFindFirstMock,
    },
    workspaceAgentConfig: {
      findUnique: vi.fn(async () => ({ agentsMd: "# AGENTS.md\n" })),
    },
    projectAgentConfig: {
      findUnique: vi.fn(async () => null),
      upsert: projectAgentConfigUpsertMock,
    },
    agentSkillDefinition: {
      findMany: vi.fn(async () => []),
    },
    agentDefinition: {
      findMany: vi.fn(async () => []),
    },
    agentSkillEnablement: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(),
      create: agentSkillEnablementCreateMock,
    },
    agentDefinitionEnablement: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(),
      create: agentDefinitionEnablementCreateMock,
    },
  },
}));

import { GET, PUT } from "../route";

describe("project agent config API", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns effective project agent config for the owner", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    projectFindFirstMock.mockResolvedValue({ id: "p1", name: "Owned", ownerId: "dev-user" });

    const res = await GET(new Request("http://localhost/api/projects/p1/agent-config"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toEqual({ id: "p1", name: "Owned" });
    expect(body.effective.agentsMd).toContain("AGENTS.md");
    expect(body.materializedFiles[0]).toEqual(expect.objectContaining({ path: "AGENTS.md" }));
  });

  it("returns 401 when unauthenticated", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "not signed in" }, { status: 401 }),
    });

    const res = await GET(new Request("http://localhost/api/projects/p1/agent-config"), {
      params: Promise.resolve({ id: "p1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-owned project", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    projectFindFirstMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/projects/p2/agent-config"), {
      params: Promise.resolve({ id: "p2" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects invalid project AGENTS.md modes", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    projectFindFirstMock.mockResolvedValue({ id: "p1", name: "Owned", ownerId: "dev-user" });

    const res = await PUT(new Request("http://localhost/api/projects/p1/agent-config", {
      method: "PUT",
      body: JSON.stringify({ agentsMode: "MERGE", agentsMd: "" }),
    }), {
      params: Promise.resolve({ id: "p1" }),
    });

    expect(res.status).toBe(400);
    expect(projectAgentConfigUpsertMock).not.toHaveBeenCalled();
  });

  it("accepts record-shaped project skill and agent states from the UI", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    projectFindFirstMock.mockResolvedValue({ id: "p1", name: "Owned", ownerId: "dev-user" });

    const res = await PUT(new Request("http://localhost/api/projects/p1/agent-config", {
      method: "PUT",
      body: JSON.stringify({
        agentsMode: "EXTEND",
        agentsMd: "## Project rules\n",
        skillStates: { skill_1: "ENABLED" },
        agentStates: { agent_1: "DISABLED" },
      }),
    }), {
      params: Promise.resolve({ id: "p1" }),
    });

    expect(res.status).toBe(200);
    expect(agentSkillEnablementCreateMock).toHaveBeenCalledWith({
      data: { skillId: "skill_1", projectId: "p1", state: "ENABLED" },
    });
    expect(agentDefinitionEnablementCreateMock).toHaveBeenCalledWith({
      data: { agentId: "agent_1", projectId: "p1", state: "DISABLED" },
    });
  });
});
