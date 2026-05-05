import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbolKeys(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Library checksum payload must not contain symbol-keyed properties");
  }
}

function assertDenseArrayKeys(value: readonly unknown[]): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new TypeError("Library checksum payload arrays must not contain non-index properties");
    }
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new TypeError("Library checksum payload arrays must not contain hidden properties");
    }
  }
}

function assertEnumerableProperties(value: object): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw new TypeError("Library checksum payload objects must not contain hidden properties");
    }
  }
}

function normalize(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Library checksum payload must contain only finite numbers");
    }
    return value;
  }
  if (
    typeof value === "undefined" ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    throw new TypeError(`Unsupported library checksum payload value: ${typeof value}`);
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Library checksum payload must not contain cycles");
    }
    assertNoSymbolKeys(value);
    if (Array.isArray(value)) {
      seen.add(value);
      const inputArray = value as readonly unknown[];
      assertDenseArrayKeys(inputArray);
      const normalized: JsonValue[] = [];
      for (let index = 0; index < inputArray.length; index += 1) {
        if (!(index in inputArray)) {
          throw new TypeError("Library checksum payload arrays must not contain sparse slots");
        }
        normalized.push(normalize(inputArray[index], seen));
      }
      seen.delete(value);
      return normalized;
    }
    if (!isPlainObject(value)) {
      throw new TypeError("Library checksum payload must contain only plain JSON objects");
    }
    assertEnumerableProperties(value);

    seen.add(value);
    const input = value as Record<string, unknown>;
    const normalized: { [key: string]: JsonValue } = {};
    for (const key of Object.getOwnPropertyNames(input).sort()) {
      normalized[key] = normalize(input[key], seen);
    }
    seen.delete(value);
    return normalized;
  }

  throw new TypeError("Unsupported library checksum payload value");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

export function checksumPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
