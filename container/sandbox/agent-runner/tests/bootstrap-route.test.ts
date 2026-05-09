import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/index.js";
import { signRequest } from "../src/hmac.js";

describe("/claude-sdk/bootstrap", () => {
  const secret = "s";
  let app: FastifyInstance;
  let defaults: string;
  let workspace: string;

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "boot-"));
    defaults = join(root, "defaults");
    workspace = join(root, "workspace");
    await mkdir(defaults, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(defaults, "CLAUDE.md"), "default-rules");
    app = await buildServer({ hmacSecret: secret, agentContextDir: defaults, workspaceDir: workspace });
  });
  afterAll(async () => { await app.close(); });

  function signed() {
    const ts = Date.now().toString();
    const sig = signRequest({ body: "", ts, secret });
    return { "content-type": "application/json", "x-runner-ts": ts, "x-runner-sig": sig };
  }

  it("merges on first call, idempotent on second", async () => {
    const r1 = await app.inject({ method: "POST", url: "/claude-sdk/bootstrap", headers: signed() });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ok: true });
    const claudeMd = await readFile(join(workspace, ".claude/CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("default-rules");

    const r2 = await app.inject({ method: "POST", url: "/claude-sdk/bootstrap", headers: signed() });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ ok: true, alreadyDone: true });
  });
});
