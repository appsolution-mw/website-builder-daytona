import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { createAgentClient } from "@/lib/runtime/worker-pool/agent-client";
import type { SandboxStatusResponse } from "@/lib/runtime/worker-pool/types";

const DEFAULT_WORKER_AGENT_TIMEOUT_MS = 10_000;

type OrphanSandbox = SandboxStatusResponse;

function workerAgentConfig(): { baseUrl: string; hmacSecret: string; timeoutMs: number } | null {
  const baseUrl = process.env.WORKER_AGENT_URL;
  const hmacSecret = process.env.WORKER_AGENT_HMAC_SECRET;
  if (!baseUrl || !hmacSecret) return null;

  const timeoutMs = Number.parseInt(process.env.WORKER_AGENT_TIMEOUT_MS ?? "", 10);
  return {
    baseUrl,
    hmacSecret,
    timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_WORKER_AGENT_TIMEOUT_MS,
  };
}

function configuredAgentClient() {
  const config = workerAgentConfig();
  return config ? createAgentClient(config) : null;
}

async function listOrphanSandboxes(): Promise<OrphanSandbox[]> {
  const agent = configuredAgentClient();
  if (!agent) return [];

  const [managedRows, workerSandboxes] = await Promise.all([
    prisma.workerSandbox.findMany({ select: { id: true } }),
    agent.listSandboxes(),
  ]);
  const managedIds = new Set(managedRows.map((row) => row.id));
  return workerSandboxes
    .filter((sandbox) => !managedIds.has(sandbox.sandboxId))
    .sort((a, b) => a.sandboxId.localeCompare(b.sandboxId));
}

export async function GET() {
  const sandboxes = await listOrphanSandboxes();
  return NextResponse.json({ sandboxes });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { sandboxId?: unknown };
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId.trim() : "";
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId is required" }, { status: 400 });
  }

  const managed = await prisma.workerSandbox.findUnique({ where: { id: sandboxId }, select: { id: true } });
  if (managed) {
    return NextResponse.json({ error: "sandbox is still managed" }, { status: 409 });
  }

  const agent = configuredAgentClient();
  if (!agent) {
    return NextResponse.json({ error: "worker agent is not configured" }, { status: 503 });
  }

  await agent.destroySandbox(sandboxId);
  return new NextResponse(null, { status: 204 });
}
