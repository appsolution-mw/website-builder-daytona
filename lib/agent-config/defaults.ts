export const WORKSPACE_AGENT_CONFIG_ID = "global";

export const OPENHANDS_AGENTS_MD_PATH = "AGENTS.md";
export const OPENHANDS_SKILLS_DIR = ".agents/skills";
export const OPENHANDS_AGENTS_DIR = ".agents/agents";
export const LEGACY_OPENHANDS_SKILLS_DIR = ".openhands/skills";

export const DEFAULT_WORKSPACE_AGENTS_MD = `# AGENTS.md

## General Behavior

- Keep changes small, focused, and maintainable.
- Prefer the existing project architecture and local abstractions.
- Preserve correct native spelling, including umlauts such as ä, ö, ü, and ß.

## OpenHands Runtime

- This project is edited from /workspace/project.
- Use AGENTS.md for always-on project context.
- Use .agents/skills/<name>/SKILL.md for optional skills.
- Use .agents/agents/<name>.md for file-based sub-agents.
`;
