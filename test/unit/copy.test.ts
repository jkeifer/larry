import { describe, it, expect } from "vitest";
import { selectionToJson } from "../../src/copy";
import { TreeModel } from "../../src/tree-model";
import type { Json } from "../../src/core";

// Build a fully-expanded model so selectionToJson runs against realistic rows
// and a real parentIndexOf (the same structural-parent lookup JsonView passes).
function build(data: Json): TreeModel {
  const m = new TreeModel(data, 100000);
  m.autoExpand();
  m.rebuildRows();
  return m;
}

// Resolve row indices from stable paths so the tests don't hard-code positions.
function idx(m: TreeModel, ...paths: string[]): number[] {
  return paths.map((p) => {
    const i = m.rows.findIndex((r) => r.path === p && !r.closing);
    if (i === -1) throw new Error(`no row for path ${p}`);
    return i;
  });
}

function copy(m: TreeModel, indices: number[]): string {
  return selectionToJson(m.rows, indices, (i) => m.parentIndexOf(i));
}

describe("selectionToJson", () => {
  it("a single selected node copies as clean valid JSON", () => {
    const m = build({ a: { x: 1, y: 2 }, b: 3 });
    const out = copy(m, idx(m, '$["a"]'));
    expect(out).toBe(JSON.stringify({ x: 1, y: 2 }, null, 2));
    expect(JSON.parse(out)).toEqual({ x: 1, y: 2 });
  });

  it("multiple siblings under an object become \"key\": value fragments joined by ,\\n", () => {
    const m = build({ a: 1, b: 2, c: 3 });
    const out = copy(m, idx(m, '$["a"]', '$["b"]'));
    expect(out).toBe('"a": 1,\n"b": 2');
  });

  it("drops a node whose ancestor is also selected (only top-level roots emitted)", () => {
    // Select both the container $["a"] and its child $["a"]["x"]; the child is
    // already contained in the parent's output, so only the parent survives —
    // and a lone surviving root copies as clean JSON, not a fragment.
    const m = build({ a: { x: 1, y: 2 } });
    const out = copy(m, idx(m, '$["a"]', '$["a"]["x"]'));
    expect(out).toBe(JSON.stringify({ x: 1, y: 2 }, null, 2));
  });

  it("labels object-parent siblings but not array-parent siblings", () => {
    // Array elements have labels ("0","1") too, but their parent is an array,
    // so they emit bare values; object siblings emit "key": value.
    const arr = build({ a: [10, 20] });
    expect(copy(arr, idx(arr, '$["a"][0]', '$["a"][1]'))).toBe("10,\n20");

    const obj = build({ a: 10, b: 20 });
    expect(copy(obj, idx(obj, '$["a"]', '$["b"]'))).toBe('"a": 10,\n"b": 20');
  });

  it("mixes labeled and unlabeled roots across different parents", () => {
    // Two roots with different parents: one under an object (labeled), one an
    // array element (unlabeled). Ancestor de-duplication is per-node.
    const m = build({ a: 1, b: [9] });
    const out = copy(m, idx(m, '$["a"]', '$["b"][0]'));
    expect(out).toBe('"a": 1,\n9');
  });
});
