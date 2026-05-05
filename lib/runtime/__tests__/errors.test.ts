import { describe, expect, it } from "vitest";
import { RuntimeError, isRuntimeError } from "../errors";

describe("RuntimeError", () => {
  it("carries a stable code and safe message", () => {
    const error = new RuntimeError(
      "NO_WORKER_CAPACITY",
      "No ready worker has a free project slot",
    );

    expect(error.name).toBe("RuntimeError");
    expect(error.code).toBe("NO_WORKER_CAPACITY");
    expect(error.message).toBe("No ready worker has a free project slot");
  });

  it("narrows unknown errors by code", () => {
    const error = new RuntimeError(
      "NO_WORKER_CAPACITY",
      "No ready worker has a free project slot",
    );

    expect(isRuntimeError(error, "NO_WORKER_CAPACITY")).toBe(true);
    expect(isRuntimeError(new Error("x"), "NO_WORKER_CAPACITY")).toBe(false);
  });
});
