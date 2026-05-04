import { describe, expect, it } from "vitest";
import { resolveEffectiveAgentConfig } from "../resolve";

describe("resolveEffectiveAgentConfig", () => {
  it("extends global AGENTS.md with project content", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "# Global\n",
      projectConfig: { agentsMode: "EXTEND", agentsMd: "## Project\n" },
      skills: [],
      agents: [],
    });

    expect(got.agentsMd).toBe("# Global\n\n## Project\n");
    expect(got.agentsMode).toBe("EXTEND");
  });

  it("replaces global AGENTS.md when project mode is replace", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "# Global\n",
      projectConfig: { agentsMode: "REPLACE", agentsMd: "# Project\n" },
      skills: [],
      agents: [],
    });

    expect(got.agentsMd).toBe("# Project\n");
  });

  it("disables a globally enabled skill for one project", () => {
    const got = resolveEffectiveAgentConfig({
      workspaceAgentsMd: "",
      projectConfig: { agentsMode: "INHERIT", agentsMd: "" },
      skills: [{
        id: "s1",
        name: "copywriting",
        description: "Copywriting help",
        body: "Write better copy.",
        triggers: ["copy"],
        workspaceState: "ENABLED",
        projectState: "DISABLED",
      }],
      agents: [],
    });

    expect(got.skills).toEqual([
      expect.objectContaining({ name: "copywriting", enabled: false }),
    ]);
  });
});
