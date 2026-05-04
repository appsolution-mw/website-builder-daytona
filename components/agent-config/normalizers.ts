import type {
  AgentConfigMode,
  AgentConfigSource,
  EffectiveAgentConfig,
  EffectiveFileAgentConfig,
  EffectiveSkillConfig,
  EnablementState,
  FileAgentConfigDto,
  GlobalAgentConfigResponse,
  MaterializedAgentFile,
  ProjectAgentConfigResponse,
  SkillConfigDto,
} from "./types";

const DEFAULT_AGENTS_MD = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function enablementState(value: unknown, fallback: EnablementState): EnablementState {
  return value === "ENABLED" || value === "DISABLED" || value === "INHERITED"
    ? value
    : fallback;
}

function agentConfigMode(value: unknown): AgentConfigMode {
  return value === "INHERIT" || value === "EXTEND" || value === "REPLACE"
    ? value
    : "EXTEND";
}

function agentConfigSource(value: unknown): AgentConfigSource {
  return value === "WORKSPACE" || value === "PROJECT" || value === "LEGACY_FILE"
    ? value
    : "WORKSPACE";
}

function enabledFromState(workspaceState: EnablementState, projectState?: EnablementState): boolean {
  const state = projectState && projectState !== "INHERITED" ? projectState : workspaceState;
  return state === "ENABLED";
}

function normalizeSkill(value: unknown): SkillConfigDto | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  if (!name) return null;
  const workspaceState = enablementState(value.workspaceState, "ENABLED");
  const projectState = value.projectState === undefined
    ? undefined
    : enablementState(value.projectState, "INHERITED");
  return {
    id: stringValue(value.id, name),
    name,
    description: stringValue(value.description),
    body: stringValue(value.body),
    triggers: stringArrayValue(value.triggers),
    workspaceState,
    ...(projectState ? { projectState } : {}),
  };
}

function normalizeAgent(value: unknown): FileAgentConfigDto | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  if (!name) return null;
  const workspaceState = enablementState(value.workspaceState, "ENABLED");
  const projectState = value.projectState === undefined
    ? undefined
    : enablementState(value.projectState, "INHERITED");
  return {
    id: stringValue(value.id, name),
    name,
    description: stringValue(value.description),
    body: stringValue(value.body),
    tools: stringArrayValue(value.tools),
    model: stringValue(value.model, "inherit"),
    skillNames: stringArrayValue(value.skillNames),
    permissionMode: nullableStringValue(value.permissionMode),
    workspaceState,
    ...(projectState ? { projectState } : {}),
  };
}

function normalizeEffectiveSkill(value: unknown): EffectiveSkillConfig | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  if (!name) return null;
  return {
    name,
    description: stringValue(value.description),
    body: stringValue(value.body),
    triggers: stringArrayValue(value.triggers),
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    source: agentConfigSource(value.source),
  };
}

function normalizeEffectiveAgent(value: unknown): EffectiveFileAgentConfig | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  if (!name) return null;
  return {
    name,
    description: stringValue(value.description),
    body: stringValue(value.body),
    tools: stringArrayValue(value.tools),
    model: stringValue(value.model, "inherit"),
    skillNames: stringArrayValue(value.skillNames),
    permissionMode: nullableStringValue(value.permissionMode),
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    source: agentConfigSource(value.source),
  };
}

function normalizeMaterializedFile(value: unknown): MaterializedAgentFile | null {
  if (!isRecord(value)) return null;
  const path = stringValue(value.path);
  if (!path) return null;
  return {
    path,
    content: stringValue(value.content),
  };
}

function normalizeArray<T>(value: unknown, normalize: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalize(item);
    return normalized ? [normalized] : [];
  });
}

export function effectiveFromEditableConfig(args: {
  agentsMd: string;
  agentsMode?: AgentConfigMode;
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}): EffectiveAgentConfig {
  return {
    agentsMd: args.agentsMd,
    agentsMode: args.agentsMode ?? "INHERIT",
    skills: args.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      triggers: skill.triggers,
      enabled: enabledFromState(skill.workspaceState, skill.projectState),
      source: "WORKSPACE",
    })),
    agents: args.agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      body: agent.body,
      tools: agent.tools,
      model: agent.model,
      skillNames: agent.skillNames,
      permissionMode: agent.permissionMode,
      enabled: enabledFromState(agent.workspaceState, agent.projectState),
      source: "WORKSPACE",
    })),
  };
}

function normalizeEffectiveConfig(
  value: unknown,
  fallback: EffectiveAgentConfig,
): EffectiveAgentConfig {
  if (!isRecord(value)) return fallback;
  return {
    agentsMd: stringValue(value.agentsMd, fallback.agentsMd),
    agentsMode: agentConfigMode(value.agentsMode),
    skills: normalizeArray(value.skills, normalizeEffectiveSkill),
    agents: normalizeArray(value.agents, normalizeEffectiveAgent),
  };
}

function editableSkillsFromEffective(effective: EffectiveAgentConfig): SkillConfigDto[] {
  return effective.skills.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    triggers: skill.triggers,
    workspaceState: skill.enabled ? "ENABLED" : "DISABLED",
    projectState: "INHERITED",
  }));
}

function editableAgentsFromEffective(effective: EffectiveAgentConfig): FileAgentConfigDto[] {
  return effective.agents.map((agent) => ({
    id: agent.name,
    name: agent.name,
    description: agent.description,
    body: agent.body,
    tools: agent.tools,
    model: agent.model,
    skillNames: agent.skillNames,
    permissionMode: agent.permissionMode,
    workspaceState: agent.enabled ? "ENABLED" : "DISABLED",
    projectState: "INHERITED",
  }));
}

export function normalizeGlobalAgentConfigResponse(raw: unknown): GlobalAgentConfigResponse {
  const record = isRecord(raw) ? raw : {};
  const agentsMd = stringValue(record.agentsMd, DEFAULT_AGENTS_MD);
  const skills = normalizeArray(record.skills, normalizeSkill);
  const agents = normalizeArray(record.agents, normalizeAgent);
  const fallbackEffective = effectiveFromEditableConfig({ agentsMd, skills, agents });
  return {
    agentsMd,
    skills,
    agents,
    effective: normalizeEffectiveConfig(record.effective, fallbackEffective),
  };
}

export function normalizeProjectAgentConfigResponse(raw: unknown): ProjectAgentConfigResponse {
  const record = isRecord(raw) ? raw : {};
  const projectRecord = isRecord(record.project) ? record.project : {};
  const projectConfigRecord = isRecord(record.projectConfig) ? record.projectConfig : {};
  const projectConfig = {
    agentsMode: agentConfigMode(projectConfigRecord.agentsMode),
    agentsMd: stringValue(projectConfigRecord.agentsMd),
  };
  const fallbackEffective = effectiveFromEditableConfig({
    agentsMd: projectConfig.agentsMd,
    agentsMode: projectConfig.agentsMode,
    skills: [],
    agents: [],
  });
  const effective = normalizeEffectiveConfig(record.effective, fallbackEffective);
  const skills = normalizeArray(record.skills, normalizeSkill);
  const agents = normalizeArray(record.agents, normalizeAgent);
  return {
    project: {
      id: stringValue(projectRecord.id),
      name: stringValue(projectRecord.name, "Project"),
    },
    projectConfig,
    skills: skills.length > 0 ? skills : editableSkillsFromEffective(effective),
    agents: agents.length > 0 ? agents : editableAgentsFromEffective(effective),
    effective,
    materializedFiles: normalizeArray(record.materializedFiles, normalizeMaterializedFile),
  };
}
