import type { LibrarySkillConfig } from "./types";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function renderSkillMarkdown(input: {
  slug: string;
  name: string;
  content: string;
  config: LibrarySkillConfig;
}): string {
  const triggerLines = input.config.triggers.length
    ? `triggers:\n${input.config.triggers.map((trigger) => `  - ${yamlString(trigger)}`).join("\n")}\n`
    : "";

  return [
    "---",
    `name: ${yamlString(input.slug)}`,
    `description: ${yamlString(input.config.description || input.name)}`,
    triggerLines.trimEnd(),
    "---",
    "",
    input.content.trim(),
    "",
  ]
    .filter((line, index) => line !== "" || index > 3)
    .join("\n");
}
