import { readFile, writeFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FsTracker } from "./fs-tracker";

const MAX_BYTES = 1024 * 1024; // 1 MB
const BINARY_SAMPLE_BYTES = 8192;
const BINARY_NULL_THRESHOLD = 0.1;

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function resolveSafe(root: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null;
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

export interface FileListResult {
  paths: string[];
}

export function handleFileList(tracker: FsTracker): FileListResult {
  return { paths: tracker.listPaths().slice().sort() };
}

export interface FileReadResult {
  path: string;
  content?: string;
  error?: "not_found" | "too_large" | "invalid_path" | "io_error" | "binary";
}

export interface FileReadOptions {
  root: string;
  path: string;
}

export async function handleFileRead(opts: FileReadOptions): Promise<FileReadResult> {
  const abs = resolveSafe(opts.root, opts.path);
  if (!abs) return { path: opts.path, error: "invalid_path" };

  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { path: opts.path, error: "not_found" };
    return { path: opts.path, error: "io_error" };
  }
  if (!st.isFile()) return { path: opts.path, error: "not_found" };
  if (st.size > MAX_BYTES) return { path: opts.path, error: "too_large" };

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return { path: opts.path, error: "io_error" };
  }
  if (buf.length > MAX_BYTES) return { path: opts.path, error: "too_large" };

  const sample = buf.subarray(0, Math.min(BINARY_SAMPLE_BYTES, buf.length));
  let nulls = 0;
  for (const byte of sample) if (byte === 0) nulls++;
  if (sample.length > 0 && nulls / sample.length > BINARY_NULL_THRESHOLD) {
    return { path: opts.path, error: "binary" };
  }

  return { path: opts.path, content: buf.toString("utf8") };
}

export interface FileWriteResult {
  path: string;
  ok: boolean;
  reason?: "locked" | "too_large" | "invalid_path" | "io_error";
}
export interface FileWriteOptions {
  root: string;
  path: string;
  content: string;
  isLocked: () => boolean;
}
export async function handleFileWrite(opts: FileWriteOptions): Promise<FileWriteResult> {
  if (opts.isLocked()) {
    return { path: opts.path, ok: false, reason: "locked" };
  }
  const abs = resolveSafe(opts.root, opts.path);
  if (!abs) return { path: opts.path, ok: false, reason: "invalid_path" };
  if (Buffer.byteLength(opts.content, "utf8") > MAX_BYTES) {
    return { path: opts.path, ok: false, reason: "too_large" };
  }

  try {
    await mkdir(dirname(abs), { recursive: true });
  } catch {
    return { path: opts.path, ok: false, reason: "io_error" };
  }

  // Re-check lock after async mkdir — a turn may have started while we awaited.
  if (opts.isLocked()) {
    return { path: opts.path, ok: false, reason: "locked" };
  }

  const tmp = join(dirname(abs), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmp, opts.content, "utf8");
    await rename(tmp, abs);
  } catch {
    try {
      await unlink(tmp);
    } catch {
      // ignore
    }
    return { path: opts.path, ok: false, reason: "io_error" };
  }
  return { path: opts.path, ok: true };
}

export { resolveSafe, toPosix, MAX_BYTES };
