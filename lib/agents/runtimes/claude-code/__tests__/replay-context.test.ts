import { describe, it, expect } from "vitest";
import { buildReplayContext } from "../replay-context";

describe("buildReplayContext", () => {
  it("returns an empty array when given no messages", () => {
    expect(buildReplayContext([])).toEqual([]);
  });

  it("maps each message to { role, text }", () => {
    const out = buildReplayContext([
      { role: "user", content: "hi", attachments: [] },
      { role: "assistant", content: "hello", attachments: [] },
    ]);
    expect(out).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
  });

  it("redacts attachments to placeholders preserving order", () => {
    const out = buildReplayContext([
      {
        role: "user",
        content: "Look at this",
        attachments: [
          { name: "img.png", sizeBytes: 1024 },
          { name: "doc.pdf", sizeBytes: 4096 },
        ],
      },
    ]);
    expect(out[0].text).toContain("Look at this");
    expect(out[0].text).toContain("[attachment img.png (1024 bytes)]");
    expect(out[0].text).toContain("[attachment doc.pdf (4096 bytes)]");
  });

  it("caps to last 20 messages", () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
      attachments: [],
    }));
    const out = buildReplayContext(msgs);
    expect(out).toHaveLength(20);
    expect(out[0].text).toBe("m10");
    expect(out[19].text).toBe("m29");
  });

  it("preserves order across user/assistant interleaving", () => {
    const out = buildReplayContext([
      { role: "user", content: "u1", attachments: [] },
      { role: "assistant", content: "a1", attachments: [] },
      { role: "user", content: "u2", attachments: [] },
    ]);
    expect(out.map((m) => `${m.role}:${m.text}`)).toEqual([
      "user:u1",
      "assistant:a1",
      "user:u2",
    ]);
  });

  it("handles missing attachments field", () => {
    const out = buildReplayContext([{ role: "user", content: "hi" }]);
    expect(out).toEqual([{ role: "user", text: "hi" }]);
  });
});
