import { describe, expect, it } from "vitest";

import { projectSourceFromCreateBody } from "../source";

describe("projectSourceFromCreateBody", () => {
  it("defaults to the template source", () => {
    expect(projectSourceFromCreateBody({})).toEqual({ type: "template" });
  });

  it("parses a GitHub repository source", () => {
    expect(projectSourceFromCreateBody({
      sourceType: "github",
      githubRepositoryId: "repo_123",
      githubBaseBranch: "main",
    })).toEqual({
      type: "github",
      repositoryId: "repo_123",
      branch: "main",
    });
  });

  it("rejects GitHub sources without a repository id", () => {
    expect(() => projectSourceFromCreateBody({
      sourceType: "github",
      githubBaseBranch: "main",
    })).toThrow(/githubRepositoryId is required/);
  });
});
