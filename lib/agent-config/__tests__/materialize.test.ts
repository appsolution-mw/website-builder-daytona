import { describe, expect, it } from "vitest";
import { materializeOpenHandsFiles } from "../materialize";

describe("materializeOpenHandsFiles", () => {
  it("writes AGENTS.md plus enabled skills and agents", () => {
    const files = materializeOpenHandsFiles({
      agentsMode: "EXTEND",
      agentsMd: "# Rules\n",
      skills: [{
        name: "seo",
        description: "SEO guidance",
        body: "Use semantic HTML.",
        triggers: ["seo"],
        enabled: true,
        source: "WORKSPACE",
      }],
      agents: [{
        name: "reviewer",
        description: "Reviews code.",
        body: "Review only.",
        tools: ["terminal"],
        model: "inherit",
        skillNames: ["seo"],
        permissionMode: null,
        enabled: true,
        source: "WORKSPACE",
      }],
    });

    expect(files.map((file) => file.path)).toEqual([
      "AGENTS.md",
      ".agents/skills/seo/SKILL.md",
      ".agents/agents/reviewer.md",
    ]);
    expect(files[1]?.content).toContain("name: seo");
    expect(files[2]?.content).toContain("tools:");
  });
});
