import type { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** Minimal child-process shape that the broker runners need at runtime. */
export interface SpawnedChild {
  stdout: Readable | null;
  stderr: Readable | null;
  stdin: Writable | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once(event: "close", listener: (code: number | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
}

/** Spawn factory — accepts the real `nodeSpawn` or a test fake. */
export type SpawnFn = (
  cmd: string,
  args: string[],
  options: Parameters<typeof nodeSpawn>[2],
) => SpawnedChild;
