import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../../../../../lib/db/client";

const WINDOW_MS = 5 * 60 * 1000;
const SHA_RE = /^[a-f0-9]{40}$/;

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UserCommitPayload {
  sha: string;
  shortSha: string;
  title: string;
  bodyMessage: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  userEmail: string;
  committedAt: string;
}

/**
 * Internal-only HMAC-signed endpoint hit by the worker-agent when it observes
 * a user-authored Git commit in the sandbox working tree. Writes a USER
 * `Commit` row idempotently — duplicate POSTs for the same (projectId, sha)
 * are rejected with 409 so they're visible in debugging, but no second row is
 * written.
 *
 * Mirrors the HMAC verification shape of `broker-ready/route.ts`:
 *   x-timestamp + x-signature, signature = HMAC_SHA256(secret,
 *   `${ts}.${method}.${path}.${body}`)
 *
 * The worker-agent is already authorized via the shared HMAC secret; the
 * sandbox lookup confirms the project context, so no user session is needed.
 */
export async function POST(req: Request, { params }: RouteParams): Promise<Response> {
  const { id: sandboxId } = await params;

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

  const expected = createHmac("sha256", secret)
    .update(`${ts}.POST.${path}.${body}`)
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(sig)) return new Response("sig-malformed", { status: 401 });
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("sig-mismatch", { status: 401 });
  }

  let payload: UserCommitPayload;
  try {
    payload = JSON.parse(body) as UserCommitPayload;
  } catch {
    return new Response("bad-json", { status: 400 });
  }
  if (!payload || typeof payload !== "object" || !SHA_RE.test(payload.sha)) {
    return new Response("invalid-sha", { status: 400 });
  }

  const sandbox = await prisma.workerSandbox.findUnique({
    where: { id: sandboxId },
    select: { projectId: true },
  });
  if (!sandbox) return new Response("unknown-sandbox", { status: 404 });

  const existing = await prisma.commit.findFirst({
    where: { projectId: sandbox.projectId, sha: payload.sha },
    select: { id: true },
  });
  if (existing) return new Response(null, { status: 409 });

  await prisma.commit.create({
    data: {
      projectId: sandbox.projectId,
      sessionId: null,
      agentRunId: null,
      sha: payload.sha,
      shortSha: payload.shortSha,
      authorKind: "USER",
      runtime: null,
      modelId: null,
      title: payload.title,
      bodyMessage: payload.bodyMessage,
      filesChanged: payload.filesChanged,
      insertions: payload.insertions,
      deletions: payload.deletions,
      userEmail: payload.userEmail,
      createdAt: new Date(payload.committedAt),
    },
  });

  return new Response(null, { status: 201 });
}
