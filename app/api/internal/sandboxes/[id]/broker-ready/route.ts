import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../../../../../lib/db/client";

const WINDOW_MS = 5 * 60 * 1000;

interface RouteParams { params: Promise<{ id: string }> }

/**
 * Internal-only HMAC-signed endpoint hit by the worker-agent once it has
 * confirmed (via TCP probe of the in-container broker) that the sandbox
 * broker is up and listening. Idempotent — repeated calls are a no-op once
 * `brokerReady` is already true.
 */
export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;

  const ts = req.headers.get("x-timestamp");
  const sig = req.headers.get("x-signature");
  if (!ts || !sig) return new Response("missing-hmac", { status: 401 });

  const tsMs = Date.parse(ts);
  if (Number.isNaN(tsMs) || Math.abs(Date.now() - tsMs) > WINDOW_MS) {
    return new Response("ts-out-of-window", { status: 401 });
  }

  const path = new URL(req.url).pathname;
  const body = await req.text();
  const secret = process.env.WORKER_AGENT_HMAC_SECRET;
  if (!secret) return new Response("server-misconfigured", { status: 500 });

  const expected = createHmac("sha256", secret).update(`${ts}.POST.${path}.${body}`).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(sig)) return new Response("sig-malformed", { status: 401 });
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("sig-mismatch", { status: 401 });
  }

  const sandbox = await prisma.workerSandbox.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!sandbox) return new Response("unknown-sandbox", { status: 404 });

  // Idempotent flip — only update when the project still exists and points at
  // this sandbox so a stale notification for a destroyed/restarted project
  // can't resurrect a flag.
  await prisma.project.updateMany({
    where: { id: sandbox.projectId, sandboxId: id },
    data: { brokerReady: true, brokerReadyAt: new Date() },
  });

  return new Response(null, { status: 204 });
}
