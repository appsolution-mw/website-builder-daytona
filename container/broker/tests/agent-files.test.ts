import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const AGENTS_DIR = join(__dirname, "../../project-template/.claude/agents");
const KNOWN_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku"]);
const KNOWN_TOOLS = new Set([
  "Read", "Write", "Edit", "Grep", "Glob", "Bash",
  "Task", "WebFetch", "WebSearch", "TodoWrite",
  "NotebookEdit", "NotebookRead",
]);

function parseFrontmatter(src: string): { frontmatter: Record<string, string>; body: string } {
  if (!src.startsWith("---\n")) {
    throw new Error("missing frontmatter opening ---");
  }
  const end = src.indexOf("\n---\n", 4);
  if (end === -1) throw new Error("missing frontmatter closing ---");
  const raw = src.slice(4, end);
  const body = src.slice(end + 5);
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

describe("agent markdown files", () => {
  it("all 4 sub-agent files exist", async () => {
    const entries = await readdir(AGENTS_DIR);
    const names = entries.filter((e) => e.endsWith(".md")).sort();
    expect(names).toEqual([
      "coder-claude.md",
      "explorer.md",
      "planner.md",
      "reviewer.md",
    ]);
  });

  for (const fileName of ["planner.md", "explorer.md", "coder-claude.md", "reviewer.md"]) {
    describe(fileName, () => {
      it("has valid frontmatter and body", async () => {
        const src = await readFile(join(AGENTS_DIR, fileName), "utf8");
        const { frontmatter, body } = parseFrontmatter(src);

        const stem = basename(fileName, ".md");
        expect(frontmatter.name).toBe(stem);

        expect(frontmatter.description).toBeTruthy();
        expect(frontmatter.description.length).toBeGreaterThan(20);

        const model = frontmatter.model;
        expect(model).toBeTruthy();
        const isAlias = KNOWN_MODEL_ALIASES.has(model);
        const isFullId = /^claude-(opus|sonnet|haiku)-\d/.test(model);
        expect(isAlias || isFullId).toBe(true);

        if (frontmatter.tools) {
          const tools = frontmatter.tools.split(",").map((t) => t.trim());
          for (const tool of tools) {
            expect(KNOWN_TOOLS.has(tool)).toBe(true);
          }
        }

        const nonEmptyLines = body.split("\n").filter((l) => l.trim().length > 0);
        expect(nonEmptyLines.length).toBeGreaterThanOrEqual(10);
      });
    });
  }

  it("orchestrator CLAUDE.md exists and mentions all four sub-agents", async () => {
    const claudeMd = await readFile(
      join(AGENTS_DIR, "../CLAUDE.md"),
      "utf8",
    );
    for (const name of ["planner", "explorer", "coder-claude", "reviewer"]) {
      expect(claudeMd).toContain(name);
    }
  });
});
