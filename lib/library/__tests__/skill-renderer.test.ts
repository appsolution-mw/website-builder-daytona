import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "../skill-renderer";

describe("renderSkillMarkdown", () => {
  it("renders deterministic OpenHands SKILL.md frontmatter with quoted scalars", () => {
    const markdown = renderSkillMarkdown({
      name: "Next.js SEO",
      slug: "nextjs-seo",
      content: "\n# Body\n\nUse metadata correctly.\n",
      config: {
        description: "SEO: metadata guidance for Next.js apps.",
        triggers: ["yes", "has spaces", "key: value"],
        allowDynamicCommands: false,
      },
    });

    expect(markdown).toBe(
      [
        "---",
        'name: "nextjs-seo"',
        'description: "SEO: metadata guidance for Next.js apps."',
        "triggers:",
        '  - "yes"',
        '  - "has spaces"',
        '  - "key: value"',
        "---",
        "",
        "# Body",
        "",
        "Use metadata correctly.",
        "",
      ].join("\n"),
    );
  });
});
