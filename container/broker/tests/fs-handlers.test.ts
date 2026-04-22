import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleFileList,
  handleFileRead,
  handleFileWrite,
} from "../src/fs-handlers";
import { createFsTracker, type FsTracker } from "../src/fs-tracker";

describe("fs-handlers", () => {
  let root: string;
  let tracker: FsTracker;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wbd-fshandlers-"));
  });

  afterEach(async () => {
    if (tracker) await tracker.close();
    await rm(root, { recursive: true, force: true });
  });

  describe("handleFileList", () => {
    it("returns sorted POSIX paths excluding ignored", async () => {
      await writeFile(join(root, "b.ts"), "b");
      await writeFile(join(root, "a.ts"), "a");
      await mkdir(join(root, "sub"));
      await writeFile(join(root, "sub", "c.ts"), "c");
      await mkdir(join(root, "node_modules"));
      await writeFile(join(root, "node_modules", "x.ts"), "x");

      tracker = await createFsTracker({ root, isAgentActive: () => false, onEvent: () => {} });
      const result = handleFileList(tracker);
      expect(result).toEqual({ paths: ["a.ts", "b.ts", "sub/c.ts"] });
    });
  });

  describe("handleFileRead", () => {
    beforeEach(async () => {
      tracker = await createFsTracker({ root, isAgentActive: () => false, onEvent: () => {} });
    });

    it("returns content for a normal text file", async () => {
      await writeFile(join(root, "hello.txt"), "hi there");
      const r = await handleFileRead({ root, path: "hello.txt" });
      expect(r).toEqual({ path: "hello.txt", content: "hi there" });
    });

    it("returns not_found when file missing", async () => {
      const r = await handleFileRead({ root, path: "missing.txt" });
      expect(r).toEqual({ path: "missing.txt", error: "not_found" });
    });

    it("returns invalid_path for absolute paths", async () => {
      const r = await handleFileRead({ root, path: "/etc/passwd" });
      expect(r).toEqual({ path: "/etc/passwd", error: "invalid_path" });
    });

    it("returns invalid_path for .. escapes", async () => {
      const r = await handleFileRead({ root, path: "../../etc/passwd" });
      expect(r).toEqual({ path: "../../etc/passwd", error: "invalid_path" });
    });

    it("returns too_large when file exceeds 1 MB", async () => {
      const big = "a".repeat(1024 * 1024 + 1);
      await writeFile(join(root, "big.txt"), big);
      const r = await handleFileRead({ root, path: "big.txt" });
      expect(r).toEqual({ path: "big.txt", error: "too_large" });
    });

    it("returns binary when first 8 KB has >10% NULL bytes", async () => {
      const buf = Buffer.alloc(8192);
      for (let i = 0; i < 2000; i++) buf[i] = 0;
      for (let i = 2000; i < buf.length; i++) buf[i] = 65;
      await writeFile(join(root, "blob.bin"), buf);
      const r = await handleFileRead({ root, path: "blob.bin" });
      expect(r).toEqual({ path: "blob.bin", error: "binary" });
    });
  });

  describe("handleFileWrite", () => {
    beforeEach(async () => {
      tracker = await createFsTracker({ root, isAgentActive: () => false, onEvent: () => {} });
    });

    it("writes content to the target path", async () => {
      const r = await handleFileWrite({
        root,
        path: "new.txt",
        content: "hello",
        isLocked: () => false,
      });
      expect(r).toEqual({ path: "new.txt", ok: true });
      const read = await readFile(join(root, "new.txt"), "utf8");
      expect(read).toBe("hello");
    });

    it("creates parent directories when missing", async () => {
      const r = await handleFileWrite({
        root,
        path: "nested/deep/file.ts",
        content: "x",
        isLocked: () => false,
      });
      expect(r.ok).toBe(true);
      const read = await readFile(join(root, "nested/deep/file.ts"), "utf8");
      expect(read).toBe("x");
    });

    it("returns locked when isLocked() is true and does not touch disk", async () => {
      await writeFile(join(root, "a.txt"), "original");
      const r = await handleFileWrite({
        root,
        path: "a.txt",
        content: "overwritten",
        isLocked: () => true,
      });
      expect(r).toEqual({ path: "a.txt", ok: false, reason: "locked" });
      expect(await readFile(join(root, "a.txt"), "utf8")).toBe("original");
    });

    it("returns invalid_path for absolute targets", async () => {
      const r = await handleFileWrite({
        root,
        path: "/etc/evil",
        content: "x",
        isLocked: () => false,
      });
      expect(r).toEqual({ path: "/etc/evil", ok: false, reason: "invalid_path" });
    });

    it("returns invalid_path for .. escapes", async () => {
      const r = await handleFileWrite({
        root,
        path: "../outside",
        content: "x",
        isLocked: () => false,
      });
      expect(r).toEqual({ path: "../outside", ok: false, reason: "invalid_path" });
    });

    it("returns too_large when content exceeds 1 MB", async () => {
      const big = "x".repeat(1024 * 1024 + 1);
      const r = await handleFileWrite({
        root,
        path: "big.txt",
        content: big,
        isLocked: () => false,
      });
      expect(r).toEqual({ path: "big.txt", ok: false, reason: "too_large" });
    });

    it("does not leave a stray tmp file when write succeeds", async () => {
      await handleFileWrite({
        root,
        path: "atomic.txt",
        content: "abc",
        isLocked: () => false,
      });
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(root);
      expect(entries.filter((n) => n.startsWith(".tmp-"))).toEqual([]);
    });
  });
});
