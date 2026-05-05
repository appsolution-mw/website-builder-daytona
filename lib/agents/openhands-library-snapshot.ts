type LibrarySnapshotSelection = {
  presetItemId: string | null;
};

type SnapshotSkill = {
  slug?: unknown;
  name?: unknown;
  content?: unknown;
};

type SnapshotAgent = {
  slug?: unknown;
  name?: unknown;
  content?: unknown;
};

type WorkflowSnapshot = {
  preset?: {
    name?: unknown;
    slug?: unknown;
  };
  skills?: unknown;
  agents?: unknown;
  tools?: unknown;
};

export function libraryPresetItemIdForRuntimeSync(input: {
  selectedLibraryPresetId: string | null;
  librarySnapshot?: LibrarySnapshotSelection;
}): string | undefined {
  if (!input.selectedLibraryPresetId) return undefined;
  if (input.librarySnapshot?.presetItemId === input.selectedLibraryPresetId) return undefined;
  return input.selectedLibraryPresetId;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function snapshotList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function renderSnapshotEntries(label: string, entries: Array<SnapshotSkill | SnapshotAgent>): string {
  if (entries.length === 0) return "";
  return [
    `${label}:`,
    ...entries.map((entry) => {
      const name = stringValue(entry.name) || stringValue(entry.slug) || "Untitled";
      const slug = stringValue(entry.slug);
      const content = stringValue(entry.content);
      return [
        `- ${slug ? `${name} (${slug})` : name}`,
        content ? content.split("\n").map((line) => `  ${line}`).join("\n") : "",
      ].filter(Boolean).join("\n");
    }),
  ].join("\n");
}

export function prependOpenHandsLibrarySnapshotToPrompt(input: {
  prompt: string;
  snapshot: unknown;
}): string {
  if (!input.snapshot || typeof input.snapshot !== "object") return input.prompt;
  const snapshot = input.snapshot as WorkflowSnapshot;
  const presetName = stringValue(snapshot.preset?.name) || stringValue(snapshot.preset?.slug) || "OpenHands preset";
  const tools = snapshotList<string>(snapshot.tools).filter((tool) => typeof tool === "string" && tool.trim());
  const sections = [
    `Active OpenHands workflow preset: ${presetName}`,
    tools.length > 0 ? `Requested tools: ${tools.join(", ")}` : "",
    renderSnapshotEntries("Skills", snapshotList<SnapshotSkill>(snapshot.skills)),
    renderSnapshotEntries("Agents", snapshotList<SnapshotAgent>(snapshot.agents)),
  ].filter(Boolean);
  if (sections.length === 0) return input.prompt;
  return [
    "<openhands-library-context>",
    sections.join("\n\n"),
    "</openhands-library-context>",
    "",
    input.prompt,
  ].join("\n");
}
