import { readFile, writeFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SENTINEL = "<!-- agent-context-merged -->";

export async function mergeAgentContext(args: {
  defaultsDir: string;
  workspaceDir: string;
}): Promise<void> {
  const claudeRoot = join(args.workspaceDir, ".claude");
  await mkdir(claudeRoot, { recursive: true });

  await mergeRoot(args.defaultsDir, claudeRoot);
}

async function mergeRoot(fromDir: string, toDir: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const e of entries) {
    const fromPath = join(fromDir, e.name);
    const toPath = join(toDir, e.name);
    if (e.isDirectory()) {
      await mkdir(toPath, { recursive: true });
      // For top-level skills/ and agents/ directories: per-name replace.
      // If the project has a same-named dir under skills/<name> or agents/<name>,
      // the user wins for that whole entry.
      if (e.name === "skills" || e.name === "agents") {
        await mergeNamed(fromPath, toPath);
      } else {
        // Recurse normally — files copy if missing.
        await copyMissingTree(fromPath, toPath);
      }
    } else if (e.name === "CLAUDE.md") {
      await mergeClaudeMd(fromPath, toPath);
    } else {
      await copyIfMissing(fromPath, toPath);
    }
  }
}

async function mergeNamed(fromDir: string, toDir: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const e of entries) {
    const fromPath = join(fromDir, e.name);
    const toPath = join(toDir, e.name);
    const exists = await stat(toPath).then(() => true).catch(() => false);
    if (exists) continue; // user wins for this entry (skill/agent name)
    if (e.isDirectory()) {
      await mkdir(toPath, { recursive: true });
      await copyMissingTree(fromPath, toPath);
    } else {
      await copyFile(fromPath, toPath);
    }
  }
}

async function copyMissingTree(fromDir: string, toDir: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const e of entries) {
    const fromPath = join(fromDir, e.name);
    const toPath = join(toDir, e.name);
    if (e.isDirectory()) {
      await mkdir(toPath, { recursive: true });
      await copyMissingTree(fromPath, toPath);
    } else {
      await copyIfMissing(fromPath, toPath);
    }
  }
}

async function copyIfMissing(from: string, to: string): Promise<void> {
  const exists = await stat(to).then(() => true).catch(() => false);
  if (!exists) await copyFile(from, to);
}

async function mergeClaudeMd(from: string, to: string): Promise<void> {
  const defaultText = await readFile(from, "utf8");
  const projectText = await readFile(to, "utf8").catch(() => "");
  if (projectText.includes(SENTINEL)) return; // already merged

  let merged: string;
  if (projectText.length > 0) {
    merged = `${defaultText}\n${SENTINEL}\n\n## Project Notes\n${projectText}`;
  } else {
    merged = `${defaultText}\n${SENTINEL}\n`;
  }
  await writeFile(to, merged);
}
