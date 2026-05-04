import { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import { listSkillDtos, upsertSkillDefinition } from "@/lib/agent-config/db";
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

function requiredStringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === "string" ? value : null;
}

function optionalStringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (value === undefined) return "";
  return typeof value === "string" ? value : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  return noStoreJson({ skills: await listSkillDtos() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return noStoreJson({ error: "request body must be an object" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const name = requiredStringField(record, "name");
  const description = optionalStringField(record, "description");
  const skillBody = requiredStringField(record, "body");
  const workspaceState: EnablementState = isEnablementState(record.workspaceState)
    ? record.workspaceState
    : "ENABLED";

  if (name === null || description === null || skillBody === null) {
    return noStoreJson({ error: "name, description, and body must be strings" }, { status: 400 });
  }

  try {
    assertSafeAgentConfigName(name);
    assertMarkdownSize(skillBody);
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "invalid skill" }, {
      status: 400,
    });
  }

  const skill = await upsertSkillDefinition({
    name,
    description,
    body: skillBody,
    triggers: stringArrayFromUnknown(record.triggers),
    workspaceState,
  });

  return noStoreJson({ skill });
}
