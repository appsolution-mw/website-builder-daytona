import { describe, expect, it, vi, afterEach } from "vitest";

const createProjectPullRequestMock = vi.hoisted(() => vi.fn());
const getProjectGitStatusMock = vi.hoisted(() => vi.fn());
const requireAccessibleProjectMock = vi.hoisted(() => vi.fn());
const projectFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUserFromRequest: vi.fn(async () => ({
    ok: true,
    user: { id: "dev-user" },
  })),
}));

vi.mock("@/lib/github/pull-requests", () => ({
  createProjectPullRequest: createProjectPullRequestMock,
  ProjectPullRequestError: class ProjectPullRequestError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/projects/broker-git", () => ({
  getProjectGitStatus: getProjectGitStatusMock,
}));

vi.mock("@/lib/workspaces/access", () => ({
  requireAccessibleProject: requireAccessibleProjectMock,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findUnique: projectFindUniqueMock,
    },
  },
}));

import { GET, POST } from "../route";

describe("/api/projects/[id]/pull-request", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns current git status and pull request URL", async () => {
    requireAccessibleProjectMock.mockResolvedValue({ id: "project-1" });
    getProjectGitStatusMock.mockResolvedValue({
      hasChanges: true,
      entries: [" M app/page.tsx"],
    });
    projectFindUniqueMock.mockResolvedValue({
      githubPullRequestUrl: "https://github.com/octo/site/pull/7",
      githubWorkingBranch: "wbd/project-1-site",
    });

    const res = await GET(new Request("http://localhost/api/projects/project-1/pull-request"), {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: { hasChanges: true, entries: [" M app/page.tsx"] },
      pullRequestUrl: "https://github.com/octo/site/pull/7",
      branch: "wbd/project-1-site",
    });
  });

  it("creates a pull request for the current user", async () => {
    createProjectPullRequestMock.mockResolvedValue({
      url: "https://github.com/octo/site/pull/8",
      branch: "wbd/project-1-site",
      commitSha: "abc123",
    });

    const res = await POST(new Request("http://localhost/api/projects/project-1/pull-request", {
      method: "POST",
      body: JSON.stringify({ title: "Save workspace changes" }),
    }), {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(res.status).toBe(201);
    expect(createProjectPullRequestMock).toHaveBeenCalledWith({
      userId: "dev-user",
      projectId: "project-1",
      title: "Save workspace changes",
    });
    await expect(res.json()).resolves.toEqual({
      pullRequest: {
        url: "https://github.com/octo/site/pull/8",
        branch: "wbd/project-1-site",
        commitSha: "abc123",
      },
    });
  });
});
