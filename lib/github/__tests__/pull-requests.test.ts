import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindFirstMock = vi.hoisted(() => vi.fn());
const projectUpdateMock = vi.hoisted(() => vi.fn());
const createInstallationAccessTokenMock = vi.hoisted(() => vi.fn());
const pushProjectChangesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/client", () => ({
  prisma: {
    project: {
      findFirst: projectFindFirstMock,
      update: projectUpdateMock,
    },
  },
}));

vi.mock("@/lib/github/app", () => ({
  createInstallationAccessToken: createInstallationAccessTokenMock,
}));

vi.mock("@/lib/projects/broker-git", () => ({
  pushProjectChanges: pushProjectChangesMock,
}));

import { createProjectPullRequest, workingBranchForProject } from "../pull-requests";

describe("workingBranchForProject", () => {
  it("creates deterministic safe branch names", () => {
    expect(workingBranchForProject({ projectId: "clx123", name: "Marketing Site!" }))
      .toBe("wbd/clx123-marketing-site");
  });
});

describe("createProjectPullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("pushes sandbox changes with a fresh installation token and opens a pull request", async () => {
    const fetchMock = vi.mocked(fetch);
    projectFindFirstMock.mockResolvedValue({
      id: "project-1",
      name: "Marketing Site",
      sourceType: "GITHUB",
      githubOwner: "octo",
      githubRepo: "site",
      githubBaseBranch: "main",
      githubWorkingBranch: null,
      githubPullRequestUrl: null,
      githubInstallation: { installationId: 123n },
      queueState: null,
    });
    createInstallationAccessTokenMock.mockResolvedValue({
      token: "installation-token",
      expires_at: "2026-05-05T12:00:00Z",
    });
    pushProjectChangesMock.mockResolvedValue({
      ok: true,
      branch: "wbd/project-1-marketing-site",
      commitSha: "abc123",
    });
    projectUpdateMock.mockResolvedValue({});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      html_url: "https://github.com/octo/site/pull/7",
      number: 7,
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));

    const result = await createProjectPullRequest({
      userId: "dev-user",
      projectId: "project-1",
      title: "Update marketing site",
    });

    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith(123n);
    expect(pushProjectChangesMock).toHaveBeenCalledWith({
      projectId: "project-1",
      branch: "wbd/project-1-marketing-site",
      commitMessage: "Update marketing site",
      remoteToken: "installation-token",
      owner: "octo",
      repo: "site",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octo/site/pulls",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer installation-token",
        }),
        body: JSON.stringify({
          title: "Update marketing site",
          head: "wbd/project-1-marketing-site",
          base: "main",
          body: "Changes prepared from Website Builder Daytona.",
        }),
      }),
    );
    expect(projectUpdateMock).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        githubWorkingBranch: "wbd/project-1-marketing-site",
        githubPullRequestUrl: "https://github.com/octo/site/pull/7",
      },
    });
    expect(result).toEqual({
      url: "https://github.com/octo/site/pull/7",
      branch: "wbd/project-1-marketing-site",
      commitSha: "abc123",
    });
  });

  it("rejects saveback while the project queue is running", async () => {
    projectFindFirstMock.mockResolvedValue({
      id: "project-1",
      name: "Marketing Site",
      sourceType: "GITHUB",
      githubOwner: "octo",
      githubRepo: "site",
      githubBaseBranch: "main",
      githubWorkingBranch: null,
      githubInstallation: { installationId: 123n },
      queueState: { state: "RUNNING" },
    });

    await expect(createProjectPullRequest({
      userId: "dev-user",
      projectId: "project-1",
    })).rejects.toMatchObject({
      code: "project_busy",
    });

    expect(createInstallationAccessTokenMock).not.toHaveBeenCalled();
    expect(pushProjectChangesMock).not.toHaveBeenCalled();
  });
}
);
