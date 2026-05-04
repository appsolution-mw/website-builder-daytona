export type AgentConfigMode = "INHERIT" | "EXTEND" | "REPLACE";
export type EnablementState = "ENABLED" | "DISABLED" | "INHERITED";
export type AgentConfigSource = "WORKSPACE" | "PROJECT" | "LEGACY_FILE";

export interface SkillConfigDto {
  id: string;
  name: string;
  description: string;
  body: string;
  triggers: string[];
  workspaceState: EnablementState;
  projectState?: EnablementState;
}

export interface FileAgentConfigDto {
  id: string;
  name: string;
  description: string;
  body: string;
  tools: string[];
  model: string;
  skillNames: string[];
  permissionMode: string | null;
  workspaceState: EnablementState;
  projectState?: EnablementState;
}

export interface EffectiveSkillConfig {
  name: string;
  description: string;
  body: string;
  triggers: string[];
  enabled: boolean;
  source: AgentConfigSource;
}

export interface EffectiveFileAgentConfig {
  name: string;
  description: string;
  body: string;
  tools: string[];
  model: string;
  skillNames: string[];
  permissionMode: string | null;
  enabled: boolean;
  source: AgentConfigSource;
}

export interface EffectiveAgentConfig {
  agentsMd: string;
  agentsMode: AgentConfigMode;
  skills: EffectiveSkillConfig[];
  agents: EffectiveFileAgentConfig[];
}

export interface MaterializedAgentFile {
  path: string;
  content: string;
}

export interface GlobalAgentConfigResponse {
  agentsMd: string;
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
  effective: EffectiveAgentConfig;
}

export interface ProjectAgentConfigResponse {
  project: {
    id: string;
    name: string;
  };
  projectConfig: {
    agentsMode: AgentConfigMode;
    agentsMd: string;
  };
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
  effective: EffectiveAgentConfig;
  materializedFiles: MaterializedAgentFile[];
}

export interface ProjectAgentConfigInput {
  agentsMode: AgentConfigMode;
  agentsMd: string;
  skillStates: Record<string, EnablementState>;
  agentStates: Record<string, EnablementState>;
}
