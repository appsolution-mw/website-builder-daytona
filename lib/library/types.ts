import type { AgentRuntime } from "@wbd/protocol";

export type LibraryItemType = "SKILL" | "AGENT" | "WORKFLOW_PRESET";
export type LibraryItemStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LibrarySkillConfig = {
  description: string;
  triggers: string[];
  allowDynamicCommands: boolean;
};

export type LibraryAgentConfig = {
  delegationName: string;
  allowedTools: string[];
  modelId: string | null;
  registration: "file-agent" | "skill-fallback";
};

export type WorkflowPresetConfig = {
  runtime: AgentRuntime;
  modelId: string | null;
  skills: Array<{ itemId: string; revisionId: string; enabled: boolean }>;
  agents: Array<{ itemId: string; revisionId: string; enabled: boolean }>;
  tools: string[];
  remote: { mode: "local" | "docker" | "api" | "cloud" };
};

export type LibraryRevisionPayload = {
  content: string;
  configJson: unknown;
};

export type ResolvedSkillSnapshot = {
  itemId: string;
  revisionId: string;
  slug: string;
  name: string;
  content: string;
  config: LibrarySkillConfig;
};

export type ResolvedAgentSnapshot = {
  itemId: string;
  revisionId: string;
  slug: string;
  name: string;
  content: string;
  config: LibraryAgentConfig;
};

export type SessionLibrarySnapshotPayload = {
  schemaVersion: 1;
  preset: {
    itemId: string | null;
    revisionId: string | null;
    slug: string | null;
    name: string | null;
  };
  runtime: AgentRuntime;
  modelId: string | null;
  tools: string[];
  remote: { mode: "local" | "docker" | "api" | "cloud" };
  skills: ResolvedSkillSnapshot[];
  agents: ResolvedAgentSnapshot[];
  createdAt: string;
};

export type LibraryExportRevision = {
  sourceRevisionId?: string;
  version: number;
  title: string;
  content: string;
  configJson: unknown;
  checksum: string;
  changeNote: string;
};

export type LibraryExportFile = {
  schemaVersion: 1;
  exportedAt: string;
  items: Array<{
    type: LibraryItemType;
    slug: string;
    name: string;
    description: string;
    tags: string[];
    status: LibraryItemStatus;
    currentRevision: LibraryExportRevision | null;
    revisions?: LibraryExportRevision[];
  }>;
};
