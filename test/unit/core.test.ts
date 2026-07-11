import { describe, it, expect } from "vitest";
import { kindOf, childPath, spliceInto, formatBytes } from "../../src/core";

describe("kindOf", () => {
  it("classifies", () => {
    expect(kindOf(null)).toBe("null");
    expect(kindOf([])).toBe("array");
    expect(kindOf({})).toBe("object");
    expect(kindOf("x")).toBe("string");
    expect(kindOf(1)).toBe("number");
    expect(kindOf(true)).toBe("boolean");
  });
});

describe("childPath", () => {
  it("brackets array indices and quotes object keys", () => {
    expect(childPath("$", "0", "array")).toBe("$[0]");
    expect(childPath("$", "a-b", "object")).toBe('$["a-b"]');
  });
});

describe("spliceInto", () => {
  it("inserts small and huge batches identically to splice", () => {
    const a = [1, 2, 3];
    spliceInto(a, 1, [9, 8]);
    expect(a).toEqual([1, 9, 8, 2, 3]);
    const big = Array.from({ length: 70000 }, (_, i) => i);
    const base = [0, -1];
    spliceInto(base, 1, big);
    expect(base.length).toBe(70002);
    expect(base[1]).toBe(0);
    expect(base[70000]).toBe(69999);
    expect(base[70001]).toBe(-1);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
