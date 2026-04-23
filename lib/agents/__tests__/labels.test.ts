import { describe, it, expect } from "vitest";
import { summariseAgentLabel } from "../labels";

describe("summariseAgentLabel", () => {
  it("returns Orchestrator for undefined", () => {
    expect(summariseAgentLabel(undefined)).toBe("Orchestrator");
  });
  it("returns Planner for 'planner'", () => {
    expect(summariseAgentLabel("planner")).toBe("Planner");
  });
  it("returns Explorer for 'explorer'", () => {
    expect(summariseAgentLabel("explorer")).toBe("Explorer");
  });
  it("returns Coder for 'coder'", () => {
    expect(summariseAgentLabel("coder")).toBe("Coder");
  });
  it("returns Reviewer for 'reviewer'", () => {
    expect(summariseAgentLabel("reviewer")).toBe("Reviewer");
  });
  it("returns the raw id for unknown sub-agent names", () => {
    expect(summariseAgentLabel("future-agent")).toBe("future-agent");
  });
});
