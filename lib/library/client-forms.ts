import type { LibraryItemType } from "./types";

export function tagsFromInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of value.split(/[,\n]/)) {
    const tag = rawTag.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function defaultContentForType(type: LibraryItemType): string {
  if (type === "AGENT") {
    return "Review code changes for correctness, regressions, missing tests, and clear ownership boundaries.";
  }
  if (type === "WORKFLOW_PRESET") return "";
  return "Describe when to use this skill and the guidance it should add to an OpenHands session.";
}

function defaultConfigForType(type: LibraryItemType): Record<string, unknown> {
  if (type === "AGENT") {
    return {
      delegationName: "reviewer",
      allowedTools: ["TerminalTool", "FileEditorTool", "TaskTrackerTool"],
      modelId: null,
      registration: "file-agent",
    };
  }
  if (type === "WORKFLOW_PRESET") {
    return {
      runtime: "openhands",
      modelId: null,
      skills: [],
      agents: [],
      tools: ["TerminalTool", "FileEditorTool", "TaskTrackerTool"],
      remote: { mode: "local" },
    };
  }
  return {
    description: "",
    triggers: [],
    allowDynamicCommands: false,
  };
}

export function configTextForItem(type: LibraryItemType, configJson: unknown): string {
  return JSON.stringify(configJson ?? defaultConfigForType(type), null, 2);
}

export function parseConfigText(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Config must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
