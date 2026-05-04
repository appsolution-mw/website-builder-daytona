import { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { listAgentDtos, upsertAgentDefinition } from "@/lib/agent-config/db";
import type { EnablementState } from "@/lib/agent-config/types";
import {
  assertMarkdownSize,
  assertSafeAgentConfigName,
  isEnablementState,
  stringArrayFromUnknown,
} from "@/lib/agent-config/validation";

function noStoreJson(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  return noStoreJson({ agents: await listAgentDtos() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return noStoreJson({ error: "request body must be an object" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  const description = typeof record.description === "string" ? record.description : "";
  const agentBody = typeof record.body === "string" ? record.body : null;
  const model = typeof record.model === "string" ? record.model : "inherit";
  const permissionMode = optionalString(record.permissionMode);
  const workspaceState: EnablementState = isEnablementState(record.workspaceState)
    ? record.workspaceState
    : "ENABLED";

  if (!name || agentBody === null) {
    return noStoreJson({ error: "name and body must be strings" }, { status: 400 });
  }

  try {
    assertSafeAgentConfigName(name);
    assertMarkdownSize(agentBody);
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "invalid agent" }, {
      status: 400,
    });
  }

  const agent = await upsertAgentDefinition({
    name,
    description,
    body: agentBody,
    tools: stringArrayFromUnknown(record.tools),
    model,
    skillNames: stringArrayFromUnknown(record.skillNames),
    permissionMode,
    workspaceState,
  });

  return noStoreJson({ agent });
}
