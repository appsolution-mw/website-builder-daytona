import type { Commit } from "@prisma/client";

export type SerializedCommit = {
  id: string;
  sha: string;
  shortSha: string;
  title: string;
  bodyMessage: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  runtime: Commit["runtime"];
  modelId: string | null;
  authorKind: Commit["authorKind"];
  sessionId: string | null;
  agentRunId: string | null;
  createdAt: string;
};

export function serializeCommit(commit: Commit): SerializedCommit {
  return {
    id: commit.id,
    sha: commit.sha,
    shortSha: commit.shortSha,
    title: commit.title,
    bodyMessage: commit.bodyMessage,
    filesChanged: commit.filesChanged,
    insertions: commit.insertions,
    deletions: commit.deletions,
    runtime: commit.runtime,
    modelId: commit.modelId,
    authorKind: commit.authorKind,
    sessionId: commit.sessionId,
    agentRunId: commit.agentRunId,
    createdAt: commit.createdAt.toISOString(),
  };
}
