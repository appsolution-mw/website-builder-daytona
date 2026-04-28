import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsTracker, type FsTracker, type FileEvent } from "../src/fs-tracker";

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}

describe("fs-tracker", () => {
  let root: string;
  let tracker: FsTracker | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wbd-fstracker-"));
  });

  afterEach(async () => {
    if (tracker) {
      await tracker.close();
      tracker = undefined;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("collects initial files into snapshot before emitting, then ready()", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "b.txt"), "world");

    const events: FileEvent[] = [];
    tracker = await createFsTracker({
      root,
      isAgentActive: () => false,
      onEvent: (e) => events.push(e),
    });

    expect(tracker.listPaths().sort()).toEqual(["a.txt", "sub/b.txt"]);
    expect(events).toEqual([]);
  });

  it("emits add/change/unlink after ready and updates listPaths()", async () => {
    const events: FileEvent[] = [];
    tracker = await createFsTracker({
      root,
      isAgentActive: () => false,
      onEvent: (e) => events.push(e),
    });

    await writeFile(join(root, "new.txt"), "1");
    const addE = await waitFor(() => events.find((e) => e.event === "add"));
    expect(addE).toEqual({ path: "new.txt", event: "add", source: "external" });
    expect(tracker.listPaths()).toContain("new.txt");

    await writeFile(join(root, "new.txt"), "2");
    await waitFor(() => events.find((e) => e.event === "change"));

    await unlink(join(root, "new.txt"));
    await waitFor(() => events.find((e) => e.event === "unlink"));
    expect(tracker.listPaths()).not.toContain("new.txt");
  });

  it("ignores node_modules, .next, .git, dist, .agent-artifacts, and *.log", async () => {
    for (const dir of ["node_modules", ".next", ".git", "dist", ".agent-artifacts"]) {
      await mkdir(join(root, dir));
      await writeFile(join(root, dir, "inside.txt"), "x");
    }
    await writeFile(join(root, "app.log"), "log");
    await writeFile(join(root, "keep.ts"), "ok");

    const events: FileEvent[] = [];
    tracker = await createFsTracker({
      root,
      isAgentActive: () => false,
      onEvent: (e) => events.push(e),
    });

    const paths = tracker.listPaths();
    expect(paths).toContain("keep.ts");
    expect(paths.every((p) => !p.startsWith("node_modules"))).toBe(true);
    expect(paths.every((p) => !p.startsWith(".next"))).toBe(true);
    expect(paths.every((p) => !p.startsWith(".git"))).toBe(true);
    expect(paths.every((p) => !p.startsWith("dist"))).toBe(true);
    expect(paths.every((p) => !p.startsWith(".agent-artifacts"))).toBe(true);
    expect(paths.every((p) => !p.endsWith(".log"))).toBe(true);
  });

  it("marks source='agent' when isAgentActive() returns true at event time", async () => {
    let active = false;
    const events: FileEvent[] = [];
    tracker = await createFsTracker({
      root,
      isAgentActive: () => active,
      onEvent: (e) => events.push(e),
    });

    active = true;
    await writeFile(join(root, "agent.txt"), "A");
    const e1 = await waitFor(() => events.find((e) => e.path === "agent.txt"));
    expect(e1.source).toBe("agent");

    active = false;
    await writeFile(join(root, "user.txt"), "U");
    const e2 = await waitFor(() => events.find((e) => e.path === "user.txt"));
    expect(e2.source).toBe("external");
  });
});
