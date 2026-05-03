import { describe, expect, it } from "vitest";

import { mapGitHubProfileToUser } from "../github-profile";

describe("mapGitHubProfileToUser", () => {
  it("keeps the provider email when GitHub returns one", () => {
    expect(mapGitHubProfileToUser({
      id: 123,
      login: "octocat",
      name: "Octo Cat",
      email: "octo@example.com",
      avatar_url: "https://example.com/avatar.png",
    })).toEqual({
      name: "Octo Cat",
      email: "octo@example.com",
      image: "https://example.com/avatar.png",
    });
  });

  it("synthesizes a stable email when GitHub keeps the account email private", () => {
    expect(mapGitHubProfileToUser({
      id: 123,
      login: "octocat",
      name: null,
      email: null,
      avatar_url: null,
    })).toEqual({
      name: "octocat",
      email: "github-123@users.noreply.github.local",
      image: undefined,
      emailVerified: false,
    });
  });
});
