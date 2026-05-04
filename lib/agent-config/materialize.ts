import {
  OPENHANDS_AGENTS_DIR,
  OPENHANDS_AGENTS_MD_PATH,
  OPENHANDS_SKILLS_DIR,
} from "./defaults";
import type { EffectiveAgentConfig } from "./types";

export interface MaterializedFile {
  path: string;
  content: string;
}

function yamlList(values: string[]): string {
  return values.length === 0
    ? " []"
    : `\n${values.map((value) => `  - ${JSON.stringify(value)}`).join("\n")}`;
}

function skillContent(skill: EffectiveAgentConfig["skills"][number]): string {
  return `---
name: ${skill.name}
description: ${JSON.stringify(skill.description)}
triggers:${yamlList(skill.triggers)}
---

${skill.body.trim()}
`;
}

function agentContent(agent: EffectiveAgentConfig["agents"][number]): string {
  const permissionLine = agent.permissionMode
    ? `permission_mode: ${JSON.stringify(agent.permissionMode)}\n`
    : "";
  return `---
name: ${agent.name}
description: ${JSON.stringify(agent.description)}
tools:${yamlList(agent.tools)}
model: ${JSON.stringify(agent.model)}
skills:${yamlList(agent.skillNames)}
${permissionLine}---

${agent.body.trim()}
`;
}

export function materializeOpenHandsFiles(config: EffectiveAgentConfig): MaterializedFile[] {
  return [
    { path: OPENHANDS_AGENTS_MD_PATH, content: config.agentsMd },
    ...config.skills
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        path: `${OPENHANDS_SKILLS_DIR}/${skill.name}/SKILL.md`,
        content: skillContent(skill),
      })),
    ...config.agents
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        path: `${OPENHANDS_AGENTS_DIR}/${agent.name}.md`,
        content: agentContent(agent),
      })),
  ];
}
