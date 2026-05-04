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
});
