import { NextResponse } from "next/server";
import { requireCurrentUserFromRequest } from "@/lib/auth/current-user";
import {
  getProjectAgentConfigSnapshot,
  setAgentEnablement,
  setSkillEnablement,
  updateProjectAgentsMd,
} from "@/lib/agent-config/db";
import { materializeOpenHandsFiles } from "@/lib/agent-config/materialize";
import { resolveEffectiveAgentConfig } from "@/lib/agent-config/resolve";
import type { AgentConfigMode, EnablementState } from "@/lib/agent-config/types";
import {
  assertMarkdownSize,
  isAgentConfigMode,
  isEnablementState,
} from "@/lib/agent-config/validation";
import { prisma } from "@/lib/db/client";

type RouteParams = {
  params: Promise<{ id: string }>;
};

interface EnablementUpdate {
  id: string;
  state: EnablementState;
}

function noStoreJson(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

async function findOwnedProject(
  projectId: string,
  ownerId: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.project.findFirst({
    where: { id: projectId, ownerId },
    select: { id: true, name: true },
  });
}

async function projectResponse(project: { id: string; name: string }): Promise<NextResponse> {
  const snapshot = await getProjectAgentConfigSnapshot(project.id);
  const effective = resolveEffectiveAgentConfig(snapshot);

  return noStoreJson({
    project: { id: project.id, name: project.name },
    projectConfig: snapshot.projectConfig,
    effective,
    materializedFiles: materializeOpenHandsFiles(effective),
  });
}

function parseEnablementUpdates(value: unknown): EnablementUpdate[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const updates: EnablementUpdate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !isEnablementState(record.state)) return null;
    updates.push({ id: record.id, state: record.state });
  }
  return updates;
}

function parseEnablementRecord(value: unknown): EnablementUpdate[] | null {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const updates: EnablementUpdate[] = [];
  for (const [id, state] of Object.entries(value)) {
    if (!isEnablementState(state)) return null;
    updates.push({ id, state });
  }
  return updates;
}

function parseEnablements(
  arrayValue: unknown,
  recordValue: unknown,
): EnablementUpdate[] | null {
  if (arrayValue !== undefined) return parseEnablementUpdates(arrayValue);
  return parseEnablementRecord(recordValue);
}

export async function GET(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await findOwnedProject(id, currentUser.user.id);
  if (!project) {
    return noStoreJson({ error: "not found" }, { status: 404 });
  }

  return projectResponse(project);
}

export async function PUT(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const currentUser = await requireCurrentUserFromRequest(request);
  if (!currentUser.ok) return currentUser.response;

  const { id } = await params;
  const project = await findOwnedProject(id, currentUser.user.id);
  if (!project) {
    return noStoreJson({ error: "not found" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return noStoreJson({ error: "request body must be an object" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const hasMode = "agentsMode" in record;
  const hasAgentsMd = "agentsMd" in record;

  if (hasMode && !isAgentConfigMode(record.agentsMode)) {
    return noStoreJson({ error: "agentsMode must be INHERIT, EXTEND, or REPLACE" }, {
      status: 400,
    });
  }

  if (hasAgentsMd && typeof record.agentsMd !== "string") {
    return noStoreJson({ error: "agentsMd must be a string" }, { status: 400 });
  }

  const skillEnablements = parseEnablements(record.skillEnablements, record.skillStates);
  const agentEnablements = parseEnablements(record.agentEnablements, record.agentStates);
  if (!skillEnablements || !agentEnablements) {
    return noStoreJson({ error: "enablements must include string id and valid state" }, {
      status: 400,
    });
  }

  if (hasAgentsMd) {
    try {
      assertMarkdownSize(record.agentsMd as string);
    } catch (error) {
      return noStoreJson({ error: error instanceof Error ? error.message : "invalid AGENTS.md" }, {
        status: 413,
      });
    }
  }

  if (hasMode || hasAgentsMd) {
    const snapshot = await getProjectAgentConfigSnapshot(project.id);
    await updateProjectAgentsMd({
      projectId: project.id,
      agentsMode: hasMode ? record.agentsMode as AgentConfigMode : snapshot.projectConfig.agentsMode,
      agentsMd: hasAgentsMd ? record.agentsMd as string : snapshot.projectConfig.agentsMd,
    });
  }

  await Promise.all([
    ...skillEnablements.map((update) => setSkillEnablement(update.id, project.id, update.state)),
    ...agentEnablements.map((update) => setAgentEnablement(update.id, project.id, update.state)),
  ]);

  return projectResponse(project);
}
