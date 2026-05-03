import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";

const REQUEST_TIMEOUT_MS = 2_000;
const MAX_UPDATE_ATTEMPTS = 8;
const UPDATE_RETRY_DELAY_MS = 250;

function devToolsConfigUrl(previewUrl: string): string {
  return new URL("/__nextjs_devtools_config", previewUrl).toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateDevToolsConfig(previewUrl: string, enabled: boolean): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(devToolsConfigUrl(previewUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disableDevIndicator: !enabled }),
        signal: controller.signal,
      });
      if (res.ok) return true;
    } catch {
      // Next may be restarting after next.config.ts changed. Retry briefly.
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_UPDATE_ATTEMPTS) {
      await delay(UPDATE_RETRY_DELAY_MS);
    }
  }
  return false;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id, ownerId: currentUser.user.id },
    select: { previewUrl: true },
  });
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!project.previewUrl) {
    return NextResponse.json({ error: "preview not available" }, { status: 409 });
  }

  if (!(await updateDevToolsConfig(project.previewUrl, body.enabled))) {
    return NextResponse.json({ error: "next devtools update failed" }, { status: 502 });
  }

  return NextResponse.json({ enabled: body.enabled });
}
