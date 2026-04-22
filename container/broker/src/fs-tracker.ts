import { watch, type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";

export interface FileEvent {
  path: string;        // POSIX, relative to root
  event: "add" | "change" | "unlink";
  source: "agent" | "external";
}

export interface FsTrackerOptions {
  root: string;
  isAgentActive: () => boolean;
  onEvent: (event: FileEvent) => void;
}

export interface FsTracker {
  listPaths: () => string[];
  has: (path: string) => boolean;
  close: () => Promise<void>;
}

const IGNORE_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)\.agent-artifacts(\/|$)/,
  /\.log$/,
];

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function isIgnored(relativePath: string): boolean {
  return IGNORE_PATTERNS.some((re) => re.test(relativePath));
}

export async function createFsTracker(opts: FsTrackerOptions): Promise<FsTracker> {
  const paths = new Set<string>();
  let ready = false;

  const watcher: FSWatcher = watch(opts.root, {
    ignored: (absPath: string) => {
      const rel = toPosix(relative(opts.root, absPath));
      if (rel === "") return false;
      return isIgnored(rel);
    },
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 40,
      pollInterval: 20,
    },
  });

  const onAdd = (absPath: string) => {
    const rel = toPosix(relative(opts.root, absPath));
    if (!rel || isIgnored(rel)) return;
    paths.add(rel);
    if (ready) {
      opts.onEvent({
        path: rel,
        event: "add",
        source: opts.isAgentActive() ? "agent" : "external",
      });
    }
  };

  const onChange = (absPath: string) => {
    const rel = toPosix(relative(opts.root, absPath));
    if (!rel || isIgnored(rel)) return;
    if (!ready) return;
    opts.onEvent({
      path: rel,
      event: "change",
      source: opts.isAgentActive() ? "agent" : "external",
    });
  };

  const onUnlink = (absPath: string) => {
    const rel = toPosix(relative(opts.root, absPath));
    if (!rel || isIgnored(rel)) return;
    paths.delete(rel);
    if (ready) {
      opts.onEvent({
        path: rel,
        event: "unlink",
        source: opts.isAgentActive() ? "agent" : "external",
      });
    }
  };

  watcher.on("add", onAdd);
  watcher.on("change", onChange);
  watcher.on("unlink", onUnlink);
  watcher.on("error", (err) => {
    console.error("[fs-tracker] chokidar error:", err);
  });

  await new Promise<void>((resolve) => {
    watcher.once("ready", () => {
      ready = true;
      resolve();
    });
  });

  return {
    listPaths: () => Array.from(paths),
    has: (p) => paths.has(p),
    close: async () => {
      await watcher.close();
    },
  };
}
