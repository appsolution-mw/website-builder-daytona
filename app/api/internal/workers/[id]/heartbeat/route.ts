import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../../../../../lib/db/client";

const WINDOW_MS = 5 * 60 * 1000;

interface RouteParams { params: Promise<{ id: string }> }

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

  const worker = await prisma.worker.findUnique({ where: { id } });
  if (!worker) return new Response("unknown-worker", { status: 404 });
  if (worker.status === "DECOMMISSIONED") return new Response("decommissioned", { status: 410 });

  await prisma.worker.update({
    where: { id },
    data: { lastHeartbeatAt: new Date(), status: "READY" },
  });
  return new Response(null, { status: 204 });
}
