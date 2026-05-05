import { describe, expect, it } from "vitest";
import { checksumPayload, stableStringify } from "../checksum";

describe("library checksum helpers", () => {
  it("stableStringify sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":1}',
    );
  });

  it("checksumPayload is stable for equivalent payloads", () => {
    const first = checksumPayload({ content: "hello", config: { z: true, a: 1 } });
    const second = checksumPayload({ config: { a: 1, z: true }, content: "hello" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("checksumPayload hashes equivalent JSON object key order the same", () => {
    const first = checksumPayload({
      items: [{ z: "last", a: "first" }],
      meta: { enabled: true, count: 2 },
    });
    const second = checksumPayload({
      meta: { count: 2, enabled: true },
      items: [{ a: "first", z: "last" }],
    });

    expect(first).toBe(second);
  });

  it("throws for unsupported non-JSON values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = Array<string>(2);
    sparse[1] = "present";
    const arrayWithExpando: string[] & { extra?: string } = ["present"];
    arrayWithExpando.extra = "ignored";
    const symbolKey = Symbol("secret");
    const objectWithSymbolKey: Record<string | symbol, unknown> = { visible: true };
    objectWithSymbolKey[symbolKey] = "hidden";
    const arrayWithSymbolKey: string[] & { [symbolKey]?: string } = ["present"];
    arrayWithSymbolKey[symbolKey] = "hidden";
    const arrayWithHiddenProperty: string[] & { hidden?: string } = ["present"];
    Object.defineProperty(arrayWithHiddenProperty, "hidden", {
      value: "ignored",
      enumerable: false,
    });
    const objectWithHiddenProperty: Record<string, unknown> = { visible: true };
    Object.defineProperty(objectWithHiddenProperty, "hidden", {
      value: "ignored",
      enumerable: false,
    });

    class Payload {
      readonly value = "x";
    }

    expect(() => stableStringify({ value: undefined })).toThrow(TypeError);
    expect(() => stableStringify({ value: BigInt("1") })).toThrow(TypeError);
    expect(() => stableStringify({ value: Symbol("x") })).toThrow(TypeError);
    expect(() => stableStringify({ value: () => "x" })).toThrow(TypeError);
    expect(() => stableStringify({ value: Number.NaN })).toThrow(TypeError);
    expect(() => stableStringify({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => stableStringify({ value: new Date("2026-04-29T00:00:00.000Z") })).toThrow(
      TypeError,
    );
    expect(() => stableStringify({ value: new Map<string, string>() })).toThrow(TypeError);
    expect(() => stableStringify({ value: new Set<string>() })).toThrow(TypeError);
    expect(() => stableStringify({ value: new Payload() })).toThrow(TypeError);
    expect(() => stableStringify({ value: sparse })).toThrow(TypeError);
    expect(() => stableStringify({ value: arrayWithExpando })).toThrow(TypeError);
    expect(() => stableStringify({ value: objectWithSymbolKey })).toThrow(TypeError);
    expect(() => stableStringify({ value: arrayWithSymbolKey })).toThrow(TypeError);
    expect(() => stableStringify({ value: arrayWithHiddenProperty })).toThrow(TypeError);
    expect(() => stableStringify({ value: objectWithHiddenProperty })).toThrow(TypeError);
    expect(() => stableStringify(cyclic)).toThrow(TypeError);
  });
});
