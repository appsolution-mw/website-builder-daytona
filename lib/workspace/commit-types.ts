export type CommitView = {
  id: string;
  sha: string;
  shortSha: string;
  title: string;
  bodyMessage: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  runtime: "CLAUDE_CODE" | "OPENAI_CODEX" | "OPENHANDS" | null;
  modelId: string | null;
  authorKind: "AGENT" | "USER" | "ROLLBACK";
  sessionId: string | null;
  agentRunId: string | null;
  revertedFromSha: string | null;
  userEmail: string | null;
  createdAt: string;
};

export type CommitFileEntry = {
  path: string;
  insertions: number;
  deletions: number;
};
