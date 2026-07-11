import { describe, it, expect } from "vitest";
import { kindOf, childPath, spliceInto, formatBytes, tryParseNdjson, searchableText } from "../../src/core";

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

describe("tryParseNdjson", () => {
  it("parses valid NDJSON with >=2 lines into an array of records", () => {
    const raw = [
      '{"id": 1, "name": "alpha", "tags": ["x", "y"]}',
      '{"id": 2, "name": "bravo", "tags": []}',
      '{"id": 3, "name": "charlie", "tags": ["z"]}',
    ].join("\n");
    expect(tryParseNdjson(raw)).toEqual([
      { id: 1, name: "alpha", tags: ["x", "y"] },
      { id: 2, name: "bravo", tags: [] },
      { id: 3, name: "charlie", tags: ["z"] },
    ]);
  });

  it("returns null for a single line", () => {
    expect(tryParseNdjson('{"id": 1}')).toBeNull();
  });

  it("returns null when any non-blank line is invalid", () => {
    const raw = ['{"id": 1}', "not json", '{"id": 3}'].join("\n");
    expect(tryParseNdjson(raw)).toBeNull();
  });

  it("ignores blank lines", () => {
    const raw = ['{"id": 1}', "", "   ", '{"id": 2}', ""].join("\n");
    expect(tryParseNdjson(raw)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe("searchableText", () => {
  it("includes the key/label", () => {
    const hay = searchableText("Href", "object", {});
    expect(hay).toContain("href");
  });

  it("includes a string value", () => {
    const hay = searchableText("url", "string", "HTTPS://Example.COM");
    expect(hay).toContain("url");
    expect(hay).toContain("https://example.com");
  });

  it("includes number, boolean, and null values", () => {
    expect(searchableText("count", "number", 42)).toContain("42");
    expect(searchableText("ok", "boolean", true)).toContain("true");
    expect(searchableText("empty", "null", null)).toContain("null");
  });

  it("is case-insensitive (lowercased haystack)", () => {
    const hay = searchableText("Title", "string", "Hello World");
    expect(hay).toBe(hay.toLowerCase());
    expect(hay).toContain("hello world");
    expect(hay).toContain("title");
  });

  it("does not include container child contents in the haystack", () => {
    // A container row matches on its label only, never on nested scalar values.
    const hay = searchableText("items", "array", ["needle"]);
    expect(hay).toContain("items");
    expect(hay).not.toContain("needle");
  });

  it("yields an empty haystack for a closing-style row (null label, null kind-ish)", () => {
    // Closing rows carry no label and their value is null; the wrapper skips
    // them, but the pure function must also produce nothing meaningful to match
    // arbitrary queries against.
    expect(searchableText(null, "array", null)).toBe("");
    expect(searchableText(null, "object", null)).toBe("");
  });

  it("supports the matching rule via case-insensitive substring", () => {
    const hay = searchableText("Description", "string", "A Long TEXT");
    expect(hay.includes("description")).toBe(true);
    expect(hay.includes("long text")).toBe(true);
    expect(hay.includes("missing")).toBe(false);
  });
});
