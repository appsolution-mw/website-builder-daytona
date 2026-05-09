import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import type { SpawnFn, SpawnedChild } from "../spawn-types";

export interface FakeSpawnScript {
  /** JSON objects to push as NDJSON lines on stdout, one per entry. */
  stdout: unknown[];
  /** Exit code to emit when all stdout is drained. Default 0. */
  exitCode?: number;
  /** ms delay before closing after pushing stdout. Default 5. */
  closeDelayMs?: number;
}

export interface FakeSpawnHandle {
  fakeSpawn: SpawnFn;
  spawns: Array<{ cmd: string; argv: string[] }>;
}

export function spawnsSetup(scripts: FakeSpawnScript[]): FakeSpawnHandle {
  const spawns: FakeSpawnHandle["spawns"] = [];
  let callIdx = 0;

  const fakeSpawn: SpawnFn = (cmd, argv) => {
    const script = scripts[callIdx++];
    if (!script) throw new Error(`fakeSpawn called ${callIdx} times, only ${scripts.length} scripts queued`);
    spawns.push({ cmd, argv: [...argv] });

    const em = new EventEmitter() as SpawnedChild & EventEmitter;
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    Object.assign(em, {
      stdout,
      stderr,
      stdin,
      kill: () => true,
    });

    queueMicrotask(() => {
      for (const obj of script.stdout) {
        stdout.push(JSON.stringify(obj) + "\n");
      }
      stdout.push(null);
      setTimeout(() => em.emit("close", script.exitCode ?? 0), script.closeDelayMs ?? 5);
    });

    return em;
  };

  return { fakeSpawn, spawns };
}
