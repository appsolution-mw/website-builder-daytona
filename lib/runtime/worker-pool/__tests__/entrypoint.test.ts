import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ENTRYPOINT_PATH = resolve(process.cwd(), "container/sandbox/entrypoint.sh");

describe("sandbox entrypoint", () => {
  it("initializes the template git repo before writing local git config", () => {
    const entrypoint = readFileSync(ENTRYPOINT_PATH, "utf8");

    const gitInitIndex = entrypoint.indexOf("git init -q -b main");
    const gitConfigIndex = entrypoint.indexOf('git config user.email "sandbox@wbd.local"');

    expect(gitInitIndex).toBeGreaterThanOrEqual(0);
    expect(gitConfigIndex).toBeGreaterThan(gitInitIndex);
  });

  it("writes managed OpenHands files after dotenv and before dependency install", () => {
    const entrypoint = readFileSync(ENTRYPOINT_PATH, "utf8");

    const dotenvIndex = entrypoint.indexOf('if [ -n "${PROJECT_ENV_B64:-}" ]; then');
    const openhandsIndex = entrypoint.indexOf('if [ -n "${OPENHANDS_FILES_B64:-}" ]; then');
    const installIndex = entrypoint.indexOf("\ninstall_project_deps\n");

    expect(dotenvIndex).toBeGreaterThanOrEqual(0);
    expect(openhandsIndex).toBeGreaterThan(dotenvIndex);
    expect(installIndex).toBeGreaterThan(openhandsIndex);
    expect(entrypoint).toContain("refusing path outside workspace");
  });
});
