export type ProjectCreateSource =
  | { type: "template" }
  | { type: "github"; repositoryId: string; branch: string };

export function projectSourceFromCreateBody(body: Record<string, unknown>): ProjectCreateSource {
  if (body.sourceType !== "github") {
    return { type: "template" };
  }

  const repositoryId = typeof body.githubRepositoryId === "string"
    ? body.githubRepositoryId.trim()
    : "";
  if (!repositoryId) {
    throw new Error("githubRepositoryId is required");
  }

  const branch = typeof body.githubBaseBranch === "string" && body.githubBaseBranch.trim()
    ? body.githubBaseBranch.trim()
    : "main";

  return { type: "github", repositoryId, branch };
}
