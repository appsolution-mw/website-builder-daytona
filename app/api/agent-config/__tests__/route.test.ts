import { afterEach, describe, expect, it, vi } from "vitest";

const requireCurrentUserFromRequestMock = vi.hoisted(() => vi.fn());
const workspaceAgentConfigUpsertMock = vi.hoisted(() => vi.fn());
const workspaceAgentConfigFindUniqueMock = vi.hoisted(() => vi.fn());
const agentSkillDefinitionUpsertMock = vi.hoisted(() => vi.fn());
const agentSkillDefinitionFindManyMock = vi.hoisted(() => vi.fn());
const agentDefinitionFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: requireCurrentUserFromRequestMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    workspaceAgentConfig: {
      findUnique: workspaceAgentConfigFindUniqueMock,
      upsert: workspaceAgentConfigUpsertMock,
    },
    agentSkillDefinition: {
      findMany: agentSkillDefinitionFindManyMock,
      upsert: agentSkillDefinitionUpsertMock,
    },
    agentDefinition: {
      findMany: agentDefinitionFindManyMock,
    },
    agentSkillEnablement: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    agentDefinitionEnablement: {
      findMany: vi.fn(),
    },
  },
}));

import { GET } from "../route";
import { PUT as PUTSkill } from "../skills/route";

describe("global agent config API", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the effective global OpenHands config", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    workspaceAgentConfigFindUniqueMock.mockResolvedValue({ agentsMd: "# Global\n" });
    agentSkillDefinitionFindManyMock.mockResolvedValue([]);
    agentDefinitionFindManyMock.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost/api/agent-config"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.effective).toEqual({
      agentsMode: "INHERIT",
      agentsMd: "# Global\n",
      skills: [],
      agents: [],
    });
  });

  it("returns 401 when unauthenticated", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "not signed in" }, { status: 401 }),
    });

    const res = await GET(new Request("http://localhost/api/agent-config"));

    expect(res.status).toBe(401);
  });

  it("rejects invalid skill names", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });

    const res = await PUTSkill(new Request("http://localhost/api/agent-config/skills", {
      method: "PUT",
      body: JSON.stringify({
        name: "Bad Name",
        description: "",
        body: "Skill body",
        triggers: [],
        workspaceState: "ENABLED",
      }),
    }));

    expect(res.status).toBe(400);
    expect(agentSkillDefinitionUpsertMock).not.toHaveBeenCalled();
  });

  it("updates global AGENTS.md", async () => {
    requireCurrentUserFromRequestMock.mockResolvedValue({
      ok: true,
      user: { id: "dev-user" },
    });
    workspaceAgentConfigUpsertMock.mockResolvedValue({
      agentsMd: "# Updated\n",
    });

    const res = await (await import("../route")).PUT(new Request("http://localhost/api/agent-config", {
      method: "PUT",
      body: JSON.stringify({ agentsMd: "# Updated\n" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agentsMd).toBe("# Updated\n");
    expect(workspaceAgentConfigUpsertMock).toHaveBeenCalledWith(expect.objectContaining({
      update: { agentsMd: "# Updated\n" },
    }));
  });
});
