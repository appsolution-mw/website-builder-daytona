import { describe, expect, it } from "vitest";
import { createProjectPublicSlugCandidate } from "../project-slug";

describe("createProjectPublicSlugCandidate", () => {
  it("normalizes project names for DNS labels", () => {
    expect(createProjectPublicSlugCandidate("Marketing Site Refresh")).toBe("marketing-site-refresh");
    expect(createProjectPublicSlugCandidate("Müller & Söhne")).toBe("muller-sohne");
    expect(createProjectPublicSlugCandidate("  Hello___World!!! ")).toBe("hello-world");
  });

  it("falls back for empty names and caps length", () => {
    expect(createProjectPublicSlugCandidate("!!!")).toBe("project");
    expect(createProjectPublicSlugCandidate("a".repeat(80))).toHaveLength(48);
  });
});
