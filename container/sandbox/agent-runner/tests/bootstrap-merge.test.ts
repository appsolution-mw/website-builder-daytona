import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeAgentContext } from "../src/bootstrap-merge.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "merge-"));
  const defaults = join(root, "defaults");
  const workspace = join(root, "workspace");
  await mkdir(defaults, { recursive: true });
  await mkdir(workspace, { recursive: true });
  return { defaults, workspace };
}

describe("mergeAgentContext", () => {
  it("copies defaults into /workspace/.claude when empty", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "default rules");
    await mkdir(join(defaults, "skills/foo"), { recursive: true });
    await writeFile(join(defaults, "skills/foo/SKILL.md"), "skill body");
    await mkdir(join(defaults, "agents"), { recursive: true });
    await writeFile(join(defaults, "agents/code-reviewer.md"), "agent body");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    expect(await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8")).toContain("default rules");
    expect(await readFile(join(workspace, ".claude/skills/foo/SKILL.md"), "utf8")).toBe("skill body");
    expect(await readFile(join(workspace, ".claude/agents/code-reviewer.md"), "utf8")).toBe("agent body");
  });

  it("project skill overrides default (per-skill replace)", async () => {
    const { defaults, workspace } = await setup();
    await mkdir(join(defaults, "skills/x"), { recursive: true });
    await writeFile(join(defaults, "skills/x/SKILL.md"), "default-skill-x");
    await mkdir(join(workspace, ".claude/skills/x"), { recursive: true });
    await writeFile(join(workspace, ".claude/skills/x/SKILL.md"), "user-skill-x");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    expect(await readFile(join(workspace, ".claude/skills/x/SKILL.md"), "utf8")).toBe("user-skill-x");
  });

  it("project agent overrides default (per-agent replace)", async () => {
    const { defaults, workspace } = await setup();
    await mkdir(join(defaults, "agents"), { recursive: true });
    await writeFile(join(defaults, "agents/reviewer.md"), "default-reviewer");
    await mkdir(join(workspace, ".claude/agents"), { recursive: true });
    await writeFile(join(workspace, ".claude/agents/reviewer.md"), "user-reviewer");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    expect(await readFile(join(workspace, ".claude/agents/reviewer.md"), "utf8")).toBe("user-reviewer");
  });

  it("CLAUDE.md is concatenated default + sentinel + project notes", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "DEFAULTS");
    await mkdir(join(workspace, ".claude"), { recursive: true });
    await writeFile(join(workspace, ".claude/CLAUDE.md"), "PROJECT");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    const merged = await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8");
    expect(merged).toContain("DEFAULTS");
    expect(merged).toContain("## Project Notes");
    expect(merged).toContain("PROJECT");
    // Default content appears before project content
    expect(merged.indexOf("DEFAULTS")).toBeLessThan(merged.indexOf("PROJECT"));
  });

  it("is idempotent (second run does not duplicate defaults)", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "X");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    const merged = await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8");
    const occurrences = merged.match(/X/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("creates /workspace/.claude when missing", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "rules");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    expect(await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8")).toContain("rules");
  });

  it("handles defaults CLAUDE.md without trailing newline", async () => {
    const { defaults, workspace } = await setup();
    await writeFile(join(defaults, "CLAUDE.md"), "no-trailing-newline"); // intentionally no \n
    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });
    const merged = await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8");
    expect(merged).toMatch(/no-trailing-newline\n\n<!-- agent-context-merged -->/);
  });

  it("does not overwrite existing project files outside CLAUDE.md", async () => {
    const { defaults, workspace } = await setup();
    await mkdir(join(defaults, "skills/y"), { recursive: true });
    await writeFile(join(defaults, "skills/y/SKILL.md"), "default-y");
    await mkdir(join(workspace, ".claude/skills/y"), { recursive: true });
    await writeFile(join(workspace, ".claude/skills/y/SKILL.md"), "project-y");
    // Project also has an extra file the defaults don't have
    await writeFile(join(workspace, ".claude/skills/y/extra.md"), "extra");

    await mergeAgentContext({ defaultsDir: defaults, workspaceDir: workspace });

    expect(await readFile(join(workspace, ".claude/skills/y/SKILL.md"), "utf8")).toBe("project-y");
    expect(await readFile(join(workspace, ".claude/skills/y/extra.md"), "utf8")).toBe("extra");
  });
});
