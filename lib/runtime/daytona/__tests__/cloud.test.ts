import { describe, expect, it } from "vitest";
import { __testing } from "../cloud";

describe("Daytona cloud runtime boot command", () => {
  it("includes project dotenv base64 in create env vars only when non-empty", () => {
    const projectEnvContent = "NEXT_PUBLIC_LABEL=Cloud\nSECRET_VALUE=hidden\n";

    expect(__testing.buildCreateEnvVars({
      projectId: "project-1",
      projectEnvContent,
    }).PROJECT_ENV_B64).toBe(Buffer.from(projectEnvContent, "utf8").toString("base64"));

    expect(__testing.buildCreateEnvVars({
      projectId: "project-1",
      projectEnvContent: "",
    })).not.toHaveProperty("PROJECT_ENV_B64");
  });

  it("includes managed OpenHands files base64 in create env vars only when non-empty", () => {
    const openhandsFiles = [
      { path: "AGENTS.md", content: "# Managed\n" },
      { path: ".agents/agents/reviewer.md", content: "Review carefully.\n" },
    ];

    expect(__testing.buildCreateEnvVars({
      projectId: "project-1",
      openhandsFiles,
    }).OPENHANDS_FILES_B64).toBe(Buffer.from(JSON.stringify(openhandsFiles), "utf8").toString("base64"));

    expect(__testing.buildCreateEnvVars({
      projectId: "project-1",
      openhandsFiles: [],
    })).not.toHaveProperty("OPENHANDS_FILES_B64");
  });

  it("does not embed project dotenv content in the shell boot command", () => {
    const projectEnvContent = "NEXT_PUBLIC_LABEL=Cloud\nSECRET_VALUE=hidden\n";
    const projectEnvBase64 = Buffer.from(projectEnvContent, "utf8").toString("base64");

    const command = __testing.buildBootCommand({
      projectId: "project-1",
      cloneToken: "token-1",
      repoOwner: "owner",
      repoName: "repo",
      branch: "main",
    });

    expect(command).not.toContain("PROJECT_ENV_B64");
    expect(command).not.toContain(projectEnvContent);
    expect(command).not.toContain(projectEnvBase64);
  });

  it("quotes branch names with single quotes safely", () => {
    const branch = "feature/o'clock";

    const command = __testing.buildBootCommand({
      projectId: "project-1",
      cloneToken: "token-1",
      repoOwner: "owner",
      repoName: "repo",
      branch,
    });

    expect(command).toContain("feature/o'\"'\"'clock");
    expect(command).not.toContain(`/tarball/${branch}`);
  });
});
