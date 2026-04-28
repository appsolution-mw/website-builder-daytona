import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listProjectFiles,
  readProjectFile,
  runProjectCommand,
  writeProjectFile,
} from "../src/vercel-ai-tools";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wbd-vercel-ai-tools-"));
});

afterEach(async () => {
  await runProjectCommand(root, "rm -rf ./* ./.??*");
});

describe("vercel-ai project tools", () => {
  it("lists readable project files while ignoring generated folders", async () => {
    await writeProjectFile(root, "app/page.tsx", "export default function Page() { return null; }");
    await writeProjectFile(root, "node_modules/pkg/index.js", "ignored");

    await expect(listProjectFiles(root)).resolves.toEqual({
      paths: ["app/page.tsx"],
    });
  });

  it("reads and writes files inside the project root", async () => {
    await expect(writeProjectFile(root, "components/Hero.tsx", "hello")).resolves.toEqual({
      ok: true,
      path: "components/Hero.tsx",
    });

    await expect(readProjectFile(root, "components/Hero.tsx")).resolves.toEqual({
      path: "components/Hero.tsx",
      content: "hello",
    });
    await expect(readFile(join(root, "components/Hero.tsx"), "utf8")).resolves.toBe("hello");
  });

  it("rejects paths outside the project root", async () => {
    await expect(writeProjectFile(root, "../escape.txt", "nope")).resolves.toMatchObject({
      ok: false,
      reason: "invalid_path",
    });
    await expect(readProjectFile(root, "../escape.txt")).resolves.toMatchObject({
      error: "invalid_path",
    });
  });

  it("runs shell commands in the project root", async () => {
    const result = await runProjectCommand(root, "pwd && printf done");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(root);
    expect(result.stdout).toContain("done");
  });
});
