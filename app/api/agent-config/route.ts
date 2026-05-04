import { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { getGlobalAgentConfig, updateWorkspaceAgentsMd } from "@/lib/agent-config/db";
import { resolveEffectiveAgentConfig } from "@/lib/agent-config/resolve";
import { assertMarkdownSize } from "@/lib/agent-config/validation";

function noStoreJson(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const config = await getGlobalAgentConfig();
  return noStoreJson({
    ...config,
    effective: resolveEffectiveAgentConfig({
      workspaceAgentsMd: config.agentsMd,
      projectConfig: { agentsMode: "INHERIT", agentsMd: "" },
      skills: config.skills,
      agents: config.agents,
    }),
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body: unknown = await request.json().catch(() => null);
  const agentsMd = body && typeof body === "object" && "agentsMd" in body
    ? (body as { agentsMd: unknown }).agentsMd
    : undefined;

  if (typeof agentsMd !== "string") {
    return noStoreJson({ error: "agentsMd must be a string" }, { status: 400 });
  }

  try {
    assertMarkdownSize(agentsMd);
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "invalid AGENTS.md" }, {
      status: 413,
    });
  }

  return noStoreJson({ agentsMd: await updateWorkspaceAgentsMd(agentsMd) });
}
