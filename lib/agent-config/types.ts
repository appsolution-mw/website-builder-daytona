export type AgentConfigMode = "INHERIT" | "EXTEND" | "REPLACE";
export type AgentConfigSource = "WORKSPACE" | "PROJECT" | "LEGACY_FILE";
export type EnablementState = "ENABLED" | "DISABLED" | "INHERITED";

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

export interface EffectiveAgentConfig {
  agentsMd: string;
  agentsMode: AgentConfigMode;
  skills: Array<{
    name: string;
    description: string;
    body: string;
    triggers: string[];
    enabled: boolean;
    source: AgentConfigSource;
  }>;
  agents: Array<{
    name: string;
    description: string;
    body: string;
    tools: string[];
    model: string;
    skillNames: string[];
    permissionMode: string | null;
    enabled: boolean;
    source: AgentConfigSource;
  }>;
}
