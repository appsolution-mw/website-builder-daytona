import { describe, expect, it } from "vitest";
import { createAgentProvider } from "../src/agent-provider-factory";

describe("createAgentProvider", () => {
  it("creates an OpenHands provider with turn and review runners", () => {
    const provider = createAgentProvider({ runtime: "openhands" });

    expect(provider.runtime).toBe("openhands");
    expect(provider.runTurn).toEqual(expect.any(Function));
    expect(provider.runReview).toEqual(expect.any(Function));
  });
});
