import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { startBroker, type BrokerHandle } from "@wbd/broker";
import type { DaytonaClient, SandboxInfo, SandboxStatus } from "./types";
import type { SpawnArgs } from "../types";

interface FakeSandbox {
  id: string;
  broker: BrokerHandle;
  preview: Server;
  previewPort: number;
  projectRoot: string;
  status: SandboxStatus;
}

// Resolve at runtime from the host process cwd (next dev runs from repo root).
const PROJECT_TEMPLATE_DIR = resolve(process.cwd(), "container/sandbox/project-template");

declare global {
  // Keep fake sandbox handles alive across repeated client factory calls in dev.
  var __wbdFakeSandboxes: Map<string, FakeSandbox> | undefined;
}

const sandboxes = globalThis.__wbdFakeSandboxes ?? new Map<string, FakeSandbox>();
globalThis.__wbdFakeSandboxes = sandboxes;

async function startPreviewServer(projectId: string): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Project Preview</title>
    <style>
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #171717; background: #fff; }
      main { padding: 2rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Hello from project ${projectId}</h1>
      <p>This is a placeholder template. Later phases will let you edit the code that runs here.</p>
    </main>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("preview server did not bind to a numeric port");
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function writeManagedOpenHandsFiles(
  projectRoot: string,
  files: NonNullable<SpawnArgs["openhandsFiles"]>,
): Promise<void> {
  const root = resolve(projectRoot);
  for (const file of files) {
    const target = resolve(root, file.path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`Refusing to write OpenHands file outside project root: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}

export function createFakeClient(): DaytonaClient {
  return {
    async spawnProjectSandbox({ projectId, projectEnvContent, openhandsFiles }: SpawnArgs): Promise<SandboxInfo> {
      const projectRoot = await mkdtemp(join(tmpdir(), `wbd-fake-${projectId}-`));
      await cp(PROJECT_TEMPLATE_DIR, projectRoot, { recursive: true });
      if (projectEnvContent) {
        await writeFile(join(projectRoot, ".env"), projectEnvContent, "utf8");
      }
      if (openhandsFiles && openhandsFiles.length > 0) {
        await writeManagedOpenHandsFiles(projectRoot, openhandsFiles);
      }
      const broker = await startBroker({ port: 0, projectRoot });
      const preview = await startPreviewServer(projectId);
      const id = `fake-${projectId}-${broker.port}`;
      sandboxes.set(id, {
        id,
        broker,
        preview: preview.server,
        previewPort: preview.port,
        projectRoot,
        status: "running",
      });
      return {
        sandboxId: id,
        brokerUrl: `ws://localhost:${broker.port}`,
        brokerPreviewToken: "",
        previewUrl: `http://localhost:${preview.port}`,
      };
    },

    async destroyProjectSandbox(sandboxId: string): Promise<void> {
      const sb = sandboxes.get(sandboxId);
      if (!sb) return;
      await Promise.all([sb.broker.close(), closeServer(sb.preview)]);
      await rm(sb.projectRoot, { recursive: true, force: true });
      sb.status = "destroyed";
      sandboxes.delete(sandboxId);
    },

    async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
      return sandboxes.get(sandboxId)?.status ?? "destroyed";
    },
  };
}
