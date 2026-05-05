import { describe, expect, it } from "vitest";
import {
  configTextForItem,
  defaultContentForType,
  parseConfigText,
  tagsFromInput,
} from "../client-forms";

describe("library client form helpers", () => {
  it("parses comma and newline separated tags with stable de-duplication", () => {
    expect(tagsFromInput("review, openhands\nreview, qa ")).toEqual([
      "review",
      "openhands",
      "qa",
    ]);
  });

  it("provides agent defaults for new library items", () => {
    expect(defaultContentForType("AGENT")).toContain("Review code changes");
    expect(configTextForItem("AGENT", null)).toBe(
      JSON.stringify(
        {
          delegationName: "reviewer",
          allowedTools: ["TerminalTool", "FileEditorTool", "TaskTrackerTool"],
          modelId: null,
          registration: "file-agent",
        },
        null,
        2,
      ),
    );
  });

  it("normalizes supported config JSON and rejects invalid config text", () => {
    expect(parseConfigText('{"modelId":"openrouter:test","tools":["TerminalTool"]}')).toEqual({
      modelId: "openrouter:test",
      tools: ["TerminalTool"],
    });
    expect(() => parseConfigText("{broken")).toThrow("Config must be valid JSON");
    expect(() => parseConfigText("[]")).toThrow("Config must be a JSON object");
  });
});
