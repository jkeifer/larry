import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

let jq: { compile(p: string): (i: unknown) => Iterable<unknown> };
beforeAll(() => {
  // The built shim is a classic script that assigns globalThis.jqjs.
  const src = readFileSync(new URL("../../result/extension/jqjs.js", import.meta.url), "utf8");
  (0, eval)(src); // trusted build artifact, not user input
  jq = (globalThis as { jqjs?: typeof jq }).jqjs!;
});

const data = { links: [{ rel: "self", href: "a" }, { rel: "child", href: "b" }], conformsTo: ["u1", "u2"] };
const run = (p: string) => [...jq.compile(p)(data)];

describe("jqjs shim (requires `nix build` first)", () => {
  it("exposes compile", () => expect(typeof jq.compile).toBe("function"));
  it("projects fields", () => expect(run(".links[] | .href")).toEqual(["a", "b"]));
  it("filters", () => expect(run('.links[] | select(.rel == "child")')[0]).toMatchObject({ rel: "child" }));
  it("deep-searches", () => expect(run('.. | select(type == "string")')).toContain("u1"));
  it("computes paths", () => expect(Array.isArray(run("[paths]")[0])).toBe(true));
});
