import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_OPTIONS,
  dbRuntimeToProtocol,
  defaultModelForRuntime,
  isAgentRuntime,
  protocolRuntimeToDb,
  runtimeLabel,
  runtimeProviderLabel,
} from "../runtime";

describe("agent runtime mappings", () => {
  const originalOpenHandsModel = process.env.OPENHANDS_MODEL;

  afterEach(() => {
    if (originalOpenHandsModel === undefined) {
      delete process.env.OPENHANDS_MODEL;
      return;
    }

    process.env.OPENHANDS_MODEL = originalOpenHandsModel;
  });

  it("includes OpenHands as a selectable runtime", () => {
    expect(AGENT_RUNTIME_OPTIONS).toContainEqual({
      value: "openhands",
      label: "OpenHands",
      provider: "OpenHands SDK",
    });
    expect(isAgentRuntime("openhands")).toBe(true);
  });

  it("maps OpenHands between protocol and Prisma", () => {
    expect(protocolRuntimeToDb("openhands")).toBe("OPENHANDS");
    expect(dbRuntimeToProtocol("OPENHANDS")).toBe("openhands");
  });

  it("returns labels and default model for OpenHands", () => {
    delete process.env.OPENHANDS_MODEL;

    expect(runtimeLabel("openhands")).toBe("OpenHands");
    expect(runtimeProviderLabel("openhands")).toBe("OpenHands SDK");
    expect(defaultModelForRuntime("openhands")).toBe("openrouter:qwen/qwen3-coder:free");
  });

  it("uses OPENHANDS_MODEL when set", () => {
    process.env.OPENHANDS_MODEL = "openrouter:test/model";

    expect(defaultModelForRuntime("openhands")).toBe("openrouter:test/model");
  });
});
