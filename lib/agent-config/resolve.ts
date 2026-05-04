import type {
  EffectiveAgentConfig,
  EnablementState,
  FileAgentConfigDto,
  SkillConfigDto,
} from "./types";

interface ResolveArgs {
  workspaceAgentsMd: string;
  projectConfig: {
    agentsMode: "INHERIT" | "EXTEND" | "REPLACE";
    agentsMd: string;
  };
  skills: SkillConfigDto[];
  agents: FileAgentConfigDto[];
}

function enabled(workspaceState: EnablementState, projectState?: EnablementState): boolean {
  const state = projectState && projectState !== "INHERITED" ? projectState : workspaceState;
  return state === "ENABLED";
}

function mergeAgentsMd(
  workspaceAgentsMd: string,
  projectMode: ResolveArgs["projectConfig"]["agentsMode"],
  projectAgentsMd: string,
): string {
  if (projectMode === "REPLACE") return projectAgentsMd;
  if (projectMode === "INHERIT" || !projectAgentsMd.trim()) return workspaceAgentsMd;
  return `${workspaceAgentsMd.trimEnd()}\n\n${projectAgentsMd.trimStart()}`;
}

export function resolveEffectiveAgentConfig(args: ResolveArgs): EffectiveAgentConfig {
  return {
    agentsMode: args.projectConfig.agentsMode,
    agentsMd: mergeAgentsMd(
      args.workspaceAgentsMd,
      args.projectConfig.agentsMode,
      args.projectConfig.agentsMd,
    ),
    skills: args.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      triggers: skill.triggers,
      enabled: enabled(skill.workspaceState, skill.projectState),
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
      enabled: enabled(agent.workspaceState, agent.projectState),
      source: "WORKSPACE",
    })),
  };
}
