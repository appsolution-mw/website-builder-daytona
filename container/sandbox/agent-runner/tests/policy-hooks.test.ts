import { describe, it, expect } from "vitest";
import {
  denyDestructiveBash,
  denyOutsideWorkspace,
  redactToolInput,
  buildPolicyHooks,
  policyHooksToSdk,
} from "../src/policy-hooks.js";

describe("denyDestructiveBash", () => {
  it("blocks rm -rf /", async () => {
    const r = await denyDestructiveBash({ tool_input: { command: "rm -rf /" } });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain("Destructive");
  });
  it("blocks rm -rf /etc", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: "rm -rf /etc/passwd" },
    });
    expect(r.allow).toBe(false);
  });
  it("allows rm -rf /workspace/foo", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: "rm -rf /workspace/foo" },
    });
    expect(r.allow).toBe(true);
  });
  it("blocks fork bombs", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: ":(){ :|: & };:" },
    });
    expect(r.allow).toBe(false);
  });
  it("blocks dd if=/dev/zero", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: "dd if=/dev/zero of=/tmp/x" },
    });
    expect(r.allow).toBe(false);
  });
  it("blocks mkfs", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: "mkfs.ext4 /dev/sda1" },
    });
    expect(r.allow).toBe(false);
  });
  it("blocks redirect to /etc", async () => {
    const r = await denyDestructiveBash({
      tool_input: { command: "echo evil > /etc/passwd" },
    });
    expect(r.allow).toBe(false);
  });
  it("allows benign commands", async () => {
    expect(
      (await denyDestructiveBash({ tool_input: { command: "ls -la" } })).allow,
    ).toBe(true);
    expect(
      (await denyDestructiveBash({ tool_input: { command: "pnpm install" } })).allow,
    ).toBe(true);
    expect(
      (await denyDestructiveBash({ tool_input: { command: "git status" } })).allow,
    ).toBe(true);
  });
  it("handles missing/empty command", async () => {
    expect((await denyDestructiveBash({ tool_input: {} })).allow).toBe(true);
    expect(
      (await denyDestructiveBash({ tool_input: { command: "" } })).allow,
    ).toBe(true);
  });
});

describe("denyOutsideWorkspace", () => {
  it("blocks Write to /etc/passwd", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { file_path: "/etc/passwd" },
    });
    expect(r.allow).toBe(false);
  });
  it("blocks Write to ../escape", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { file_path: "/workspace/../etc/passwd" },
    });
    expect(r.allow).toBe(false);
  });
  it("allows /workspace/foo..bar.ts (filename with .. substring, not segment)", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { file_path: "/workspace/foo..bar.ts" },
    });
    expect(r.allow).toBe(true);
  });
  it("allows Write to /workspace/x", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { file_path: "/workspace/x" },
    });
    expect(r.allow).toBe(true);
  });
  it("allows nested /workspace/sub/path", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { file_path: "/workspace/a/b/c.ts" },
    });
    expect(r.allow).toBe(true);
  });
  it("uses path field if file_path absent", async () => {
    const r = await denyOutsideWorkspace({
      tool_input: { path: "/etc/passwd" },
    });
    expect(r.allow).toBe(false);
  });
  it("blocks when path missing entirely (cannot verify safety)", async () => {
    const r = await denyOutsideWorkspace({ tool_input: {} });
    expect(r.allow).toBe(false);
  });
});

describe("redactToolInput", () => {
  it("truncates long strings to 200 chars + suffix", () => {
    const out = redactToolInput({ command: "x".repeat(500) });
    expect(typeof out.command).toBe("string");
    expect((out.command as string).length).toBeLessThan(500);
    expect(out.command).toMatch(/\.\.\.\(truncated\)$/);
  });
  it("preserves short strings unchanged", () => {
    expect(redactToolInput({ command: "ls" })).toEqual({ command: "ls" });
  });
  it("preserves non-string fields", () => {
    expect(redactToolInput({ count: 5, flag: true })).toEqual({
      count: 5,
      flag: true,
    });
  });
});

describe("buildPolicyHooks", () => {
  it("returns PreToolUse matchers for Bash and Write|Edit", () => {
    const hooks = buildPolicyHooks({ emitViolation: () => {} });
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse.length).toBeGreaterThanOrEqual(2);
    expect(hooks.PreToolUse.some((h) => h.matcher === "Bash")).toBe(true);
    expect(hooks.PreToolUse.some((h) => h.matcher === "Write|Edit")).toBe(true);
  });
  it("emits violation event when a hook denies", async () => {
    const violations: Array<{
      tool: string;
      reason: string;
      redactedInput: Record<string, unknown>;
    }> = [];
    const hooks = buildPolicyHooks({
      emitViolation: (v) => violations.push(v),
    });
    const bashEntry = hooks.PreToolUse.find((h) => h.matcher === "Bash")!;
    const result = await bashEntry.hooks[0]({
      tool_input: { command: "rm -rf /" },
    } as never);
    expect(result.allow).toBe(false);
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatchObject({
      tool: "Bash",
      reason: expect.stringContaining("Destructive"),
    });
    expect(violations[0].redactedInput).toEqual({ command: "rm -rf /" });
  });
  it("does not emit when a hook allows", async () => {
    const violations: Array<{
      tool: string;
      reason: string;
      redactedInput: Record<string, unknown>;
    }> = [];
    const hooks = buildPolicyHooks({
      emitViolation: (v) => violations.push(v),
    });
    const writeEntry = hooks.PreToolUse.find(
      (h) => h.matcher === "Write|Edit",
    )!;
    const result = await writeEntry.hooks[0]({
      tool_input: { file_path: "/workspace/ok.txt" },
    } as never);
    expect(result.allow).toBe(true);
    expect(violations.length).toBe(0);
  });
});

describe("policyHooksToSdk", () => {
  it("translates allow → empty SDK output", async () => {
    const sdk = policyHooksToSdk(buildPolicyHooks({ emitViolation: () => {} }));
    const bash = sdk.PreToolUse![0];
    const cb = bash.hooks[0];
    const out = await cb(
      { tool_input: { command: "ls" } } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(out).toEqual({});
  });

  it("translates deny → SDK { decision: 'block', reason }", async () => {
    const sdk = policyHooksToSdk(buildPolicyHooks({ emitViolation: () => {} }));
    const bash = sdk.PreToolUse![0];
    const cb = bash.hooks[0];
    const out = await cb(
      { tool_input: { command: "rm -rf /" } } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    expect(out).toMatchObject({ decision: "block" });
    expect((out as { reason?: string }).reason).toContain("Destructive");
  });
});
