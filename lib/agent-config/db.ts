import { prisma } from "@/lib/db/client";
import { DEFAULT_WORKSPACE_AGENTS_MD, WORKSPACE_AGENT_CONFIG_ID } from "./defaults";
import { resolveEffectiveAgentConfig } from "./resolve";
import type {
  AgentConfigMode,
  EffectiveAgentConfig,
  EnablementState,
  FileAgentConfigDto,
  SkillConfigDto,
} from "./types";
import { isEnablementState, stringArrayFromUnknown } from "./validation";

interface EnablementRow {
  projectId: string | null;
  state: string;
}

interface SkillDefinitionRow {
  id: string;
  name: string;
  description: string;
  body: string;
  triggers: unknown;
  enablements: EnablementRow[];
}

interface AgentDefinitionRow {
  id: string;
  name: string;
  description: string;
  body: string;
  tools: unknown;
  model: string;
  skillNames: unknown;
  permissionMode: string | null;
  enablements: EnablementRow[];
}

export interface AgentConfigSnapshot {
  workspaceAgentsMd: string;
  projectConfig: {
    agentsMode: AgentConfigMode;
    agentsMd: string;
  };
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}

function enablementStateOrDefault(value: string | undefined, fallback: EnablementState): EnablementState {
  return isEnablementState(value) ? value : fallback;
}

function workspaceState(enablements: EnablementRow[]): EnablementState {
  const row = enablements.find((enablement) => enablement.projectId === null);
  return enablementStateOrDefault(row?.state, "DISABLED");
}

function projectState(enablements: EnablementRow[], projectId?: string): EnablementState | undefined {
  if (!projectId) return undefined;
  const row = enablements.find((enablement) => enablement.projectId === projectId);
  return row ? enablementStateOrDefault(row.state, "INHERITED") : undefined;
}

function skillDto(row: SkillDefinitionRow, projectId?: string): SkillConfigDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    triggers: stringArrayFromUnknown(row.triggers),
    workspaceState: workspaceState(row.enablements),
    projectState: projectState(row.enablements, projectId),
  };
}

function agentDto(row: AgentDefinitionRow, projectId?: string): FileAgentConfigDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    tools: stringArrayFromUnknown(row.tools),
    model: row.model,
    skillNames: stringArrayFromUnknown(row.skillNames),
    permissionMode: row.permissionMode,
    workspaceState: workspaceState(row.enablements),
    projectState: projectState(row.enablements, projectId),
  };
}

function enablementWhere(projectId?: string): object {
  if (!projectId) return { projectId: null };
  return { OR: [{ projectId: null }, { projectId }] };
}

export async function getWorkspaceAgentsMd(): Promise<string> {
  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { id: WORKSPACE_AGENT_CONFIG_ID },
    select: { agentsMd: true },
  });
  return config?.agentsMd ?? DEFAULT_WORKSPACE_AGENTS_MD;
}

export async function updateWorkspaceAgentsMd(agentsMd: string): Promise<string> {
  const config = await prisma.workspaceAgentConfig.upsert({
    where: { id: WORKSPACE_AGENT_CONFIG_ID },
    create: { id: WORKSPACE_AGENT_CONFIG_ID, agentsMd },
    update: { agentsMd },
    select: { agentsMd: true },
  });
  return config.agentsMd;
}

export async function listSkillDtos(projectId?: string): Promise<SkillConfigDto[]> {
  const rows = await prisma.agentSkillDefinition.findMany({
    orderBy: { name: "asc" },
    include: {
      enablements: {
        where: enablementWhere(projectId),
        select: { projectId: true, state: true },
      },
    },
  });
  return rows.map((row) => skillDto(row, projectId));
}

export async function listAgentDtos(projectId?: string): Promise<FileAgentConfigDto[]> {
  const rows = await prisma.agentDefinition.findMany({
    orderBy: { name: "asc" },
    include: {
      enablements: {
        where: enablementWhere(projectId),
        select: { projectId: true, state: true },
      },
    },
  });
  return rows.map((row) => agentDto(row, projectId));
}

export async function getGlobalAgentConfig(): Promise<{
  agentsMd: string;
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}> {
  const [agentsMd, skills, agents] = await Promise.all([
    getWorkspaceAgentsMd(),
    listSkillDtos(),
    listAgentDtos(),
  ]);
  return { agentsMd, skills, agents };
}

export async function upsertSkillDefinition(input: {
  name: string;
  description: string;
  body: string;
  triggers: string[];
  workspaceState: EnablementState;
}): Promise<SkillConfigDto> {
  const definition = await prisma.agentSkillDefinition.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      description: input.description,
      body: input.body,
      triggers: input.triggers,
      source: "WORKSPACE",
    },
    update: {
      description: input.description,
      body: input.body,
      triggers: input.triggers,
    },
    include: {
      enablements: {
        where: { projectId: null },
        select: { projectId: true, state: true },
      },
    },
  });
  await setSkillEnablement(definition.id, null, input.workspaceState);
  return {
    ...skillDto(definition),
    workspaceState: input.workspaceState,
  };
}

export async function upsertAgentDefinition(input: {
  name: string;
  description: string;
  body: string;
  tools: string[];
  model: string;
  skillNames: string[];
  permissionMode: string | null;
  workspaceState: EnablementState;
}): Promise<FileAgentConfigDto> {
  const definition = await prisma.agentDefinition.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      description: input.description,
      body: input.body,
      tools: input.tools,
      model: input.model,
      skillNames: input.skillNames,
      permissionMode: input.permissionMode,
      source: "WORKSPACE",
    },
    update: {
      description: input.description,
      body: input.body,
      tools: input.tools,
      model: input.model,
      skillNames: input.skillNames,
      permissionMode: input.permissionMode,
    },
    include: {
      enablements: {
        where: { projectId: null },
        select: { projectId: true, state: true },
      },
    },
  });
  await setAgentEnablement(definition.id, null, input.workspaceState);
  return {
    ...agentDto(definition),
    workspaceState: input.workspaceState,
  };
}

export async function getProjectAgentConfigSnapshot(projectId: string): Promise<AgentConfigSnapshot> {
  const [workspaceAgentsMd, projectConfig, skills, agents] = await Promise.all([
    getWorkspaceAgentsMd(),
    prisma.projectAgentConfig.findUnique({
      where: { projectId },
      select: { agentsMode: true, agentsMd: true },
    }),
    listSkillDtos(projectId),
    listAgentDtos(projectId),
  ]);

  return {
    workspaceAgentsMd,
    projectConfig: projectConfig ?? { agentsMode: "EXTEND", agentsMd: "" },
    skills,
    agents,
  };
}

export async function getEffectiveAgentConfig(projectId: string): Promise<EffectiveAgentConfig> {
  return resolveEffectiveAgentConfig(await getProjectAgentConfigSnapshot(projectId));
}

export async function updateProjectAgentsMd(input: {
  projectId: string;
  agentsMode: AgentConfigMode;
  agentsMd: string;
}): Promise<void> {
  await prisma.projectAgentConfig.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      agentsMode: input.agentsMode,
      agentsMd: input.agentsMd,
    },
    update: {
      agentsMode: input.agentsMode,
      agentsMd: input.agentsMd,
    },
  });
}

export async function setSkillEnablement(
  skillId: string,
  projectId: string | null,
  state: EnablementState,
): Promise<void> {
  await prisma.agentSkillEnablement.deleteMany({ where: { skillId, projectId } });
  await prisma.agentSkillEnablement.create({ data: { skillId, projectId, state } });
}

export async function setAgentEnablement(
  agentId: string,
  projectId: string | null,
  state: EnablementState,
): Promise<void> {
  await prisma.agentDefinitionEnablement.deleteMany({ where: { agentId, projectId } });
  await prisma.agentDefinitionEnablement.create({ data: { agentId, projectId, state } });
}
