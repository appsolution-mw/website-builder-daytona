import { describe, expect, it } from "vitest";

import {
  normalizeGlobalAgentConfigResponse,
  normalizeProjectAgentConfigResponse,
} from "@/components/agent-config/normalizers";

describe("agent config UI normalizers", () => {
  it("normalizes partial global responses into safe defaults", () => {
    const got = normalizeGlobalAgentConfigResponse({
      agentsMd: "# Workspace",
      skills: [
        {
          id: "skill-1",
          name: "copywriting",
          description: "Copy help",
          body: "Write better copy.",
          triggers: ["copy"],
          workspaceState: "ENABLED",
        },
      ],
    });

    expect(got.agentsMd).toBe("# Workspace");
    expect(got.skills).toHaveLength(1);
    expect(got.skills[0]?.workspaceState).toBe("ENABLED");
    expect(got.agents).toEqual([]);
  });

  it("falls back to effective project items when editable lists are absent", () => {
    const got = normalizeProjectAgentConfigResponse({
      project: { id: "p1", name: "Project" },
      projectConfig: { agentsMode: "EXTEND", agentsMd: "## Project" },
      effective: {
        agentsMode: "EXTEND",
        agentsMd: "# Workspace\n\n## Project",
        skills: [
          {
            name: "seo",
            description: "SEO checks",
            body: "Inspect metadata.",
            triggers: ["seo"],
            enabled: true,
            source: "WORKSPACE",
          },
        ],
        agents: [],
      },
      materializedFiles: [{ path: "AGENTS.md", content: "# Workspace\n\n## Project" }],
    });

    expect(got.projectConfig.agentsMode).toBe("EXTEND");
    expect(got.skills[0]).toMatchObject({
      id: "seo",
      name: "seo",
      projectState: "INHERITED",
      workspaceState: "ENABLED",
    });
    expect(got.materializedFiles).toHaveLength(1);
  });
});
