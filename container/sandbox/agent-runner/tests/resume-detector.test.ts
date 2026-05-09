import { describe, it, expect } from "vitest";
import { detectResumeOutcome, buildReplayPrompt } from "../src/resume-detector.js";

describe("detectResumeOutcome", () => {
  it("flags resumed=true when session ids match", () => {
    expect(detectResumeOutcome({ requested: "s1", got: "s1" })).toEqual({ resumed: true });
  });
  it("flags resumed=false when ids differ", () => {
    expect(detectResumeOutcome({ requested: "s1", got: "s2" })).toEqual({ resumed: false });
  });
});

describe("buildReplayPrompt", () => {
  it("returns the original prompt when replayContext is empty", () => {
    expect(buildReplayPrompt({ replayContext: [], prompt: "hi" })).toBe("hi");
  });

  it("prepends conversation history before the new prompt", () => {
    const out = buildReplayPrompt({
      replayContext: [
        { role: "user", text: "build me a blog" },
        { role: "assistant", text: "Sure, what tech stack?" },
      ],
      prompt: "Use Next.js 16",
    });
    expect(out).toContain("[Previous conversation]");
    expect(out).toContain("user: build me a blog");
    expect(out).toContain("assistant: Sure, what tech stack?");
    expect(out).toContain("[Current message]");
    expect(out).toContain("Use Next.js 16");
    // The prompt comes AFTER the previous conversation
    expect(out.indexOf("[Previous conversation]")).toBeLessThan(out.indexOf("[Current message]"));
  });

  it("preserves message order even with many entries", () => {
    const ctx = Array.from({ length: 5 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `m${i}`,
    }));
    const out = buildReplayPrompt({ replayContext: ctx, prompt: "next" });
    const positions = ctx.map((m) => out.indexOf(`${m.role}: ${m.text}`));
    // Each subsequent line appears later than the previous
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  });
});
