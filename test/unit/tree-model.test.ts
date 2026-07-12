import { describe, it, expect } from "vitest";
import { TreeModel, Row } from "../../src/tree-model";
import type { Json } from "../../src/core";

// Build a model, auto-expand to the (optional) budget, and materialize.
function build(data: Json, rowBudget?: number, expandCap?: number): TreeModel {
  const m = new TreeModel(data, rowBudget, expandCap);
  m.autoExpand();
  m.rebuildRows();
  return m;
}

// A compact snapshot of the row list, ignoring the concrete value payloads.
function shape(rows: readonly Row[]): Array<{ path: string; depth: number; closing: boolean }> {
  return rows.map((r) => ({ path: r.path, depth: r.depth, closing: !!r.closing }));
}

describe("rebuildRows / materialization", () => {
  it("produces root, children, and closing rows with correct depths and paths", () => {
    const m = build({ a: 1, b: [10, 20] });
    // Fully expanded (small doc): root, a, b, b[0], b[1], close(b), close(root).
    expect(shape(m.rows)).toEqual([
      { path: "$", depth: 0, closing: false },
      { path: '$["a"]', depth: 1, closing: false },
      { path: '$["b"]', depth: 1, closing: false },
      { path: '$["b"][0]', depth: 2, closing: false },
      { path: '$["b"][1]', depth: 2, closing: false },
      { path: '$["b"] )', depth: 1, closing: true },
      { path: "$ )", depth: 0, closing: true },
    ]);
  });

  it("marks containers expandable only when non-empty", () => {
    const m = build({ empty: {}, one: [1] });
    const empty = m.rows.find((r) => r.path === '$["empty"]')!;
    const one = m.rows.find((r) => r.path === '$["one"]')!;
    expect(empty.expandable).toBe(false);
    expect(one.expandable).toBe(true);
  });

  it("treats a scalar root as a single row with no children", () => {
    const m = build(42);
    expect(m.rows.map((r) => r.path)).toEqual(["$"]);
    expect(m.rows[0].expandable).toBe(false);
  });
});

describe("toggle", () => {
  it("expand then collapse returns to the prior row set", () => {
    // Start fully collapsed (only the root row), then toggle the root open and
    // shut and confirm the row set round-trips exactly.
    const m = new TreeModel({ a: { b: 1 } }, Infinity);
    m.rebuildRows();
    const before = shape(m.rows);
    expect(before).toEqual([{ path: "$", depth: 0, closing: false }]);

    const expandRes = m.toggle(0);
    expect(expandRes).toEqual({ ok: true });
    expect(m.rows.length).toBeGreaterThan(1);
    expect(m.expanded.has("$")).toBe(true);

    const collapseRes = m.toggle(0);
    expect(collapseRes).toEqual({ ok: true });
    expect(m.expanded.has("$")).toBe(false);
    expect(shape(m.rows)).toEqual(before);
  });

  it("is a no-op on a leaf row", () => {
    const m = build({ a: 1 });
    const leafIdx = m.rows.findIndex((r) => r.path === '$["a"]');
    const before = shape(m.rows);
    expect(m.toggle(leafIdx)).toEqual({ ok: true });
    expect(shape(m.rows)).toEqual(before);
  });

  it("nested expanded state survives a collapse+expand of the parent", () => {
    // Fully expand, then collapse the root (index 0). The root's `expanded`
    // entry is removed but the descendants' entries persist, so re-expanding
    // the root restores the inner container in its open state.
    const m = build({ outer: { inner: { leaf: 1 } } }, 100000);
    expect(m.expanded.has('$["outer"]')).toBe(true);

    m.toggle(0); // collapse root
    expect(m.expanded.has("$")).toBe(false);
    expect(m.expanded.has('$["outer"]')).toBe(true); // inner state retained

    m.toggle(0); // re-expand root
    const outer = m.rows.find((r) => r.path === '$["outer"]')!;
    expect(outer).toBeDefined();
    expect(m.expanded.has(outer.path)).toBe(true); // inner came back expanded
  });
});

describe("EXPAND_CAP refusal", () => {
  it("toggle refuses and does not mutate when a single expand blows the cap", () => {
    // expandCap tiny: root has 3 children; start collapsed then try to expand.
    const m = new TreeModel({ a: 1, b: 2, c: 3 }, Infinity, 1);
    m.rebuildRows(); // no auto-expand: only the root row exists
    const before = shape(m.rows);
    const res = m.toggle(0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.wouldAdd).toBe(3);
    expect(m.expanded.has("$")).toBe(false);
    expect(shape(m.rows)).toEqual(before); // unchanged
  });

  it("expandLevel refuses and does not mutate when the step blows the cap", () => {
    const m = new TreeModel({ a: 1, b: 2, c: 3 }, Infinity, 1);
    m.rebuildRows();
    const before = shape(m.rows);
    const res = m.expandLevel();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.wouldAdd).toBe(3);
    expect(shape(m.rows)).toEqual(before);
  });
});

describe("autoExpand / fitDepth budgeting", () => {
  it("with a tiny budget only the shallowest levels expand", () => {
    // A document 3 levels deep. With a budget that fits only the top level's
    // node count, deeper containers stay collapsed.
    const data: Json = { l1a: { l2a: { l3: 1 } }, l1b: { l2b: { l3: 2 } } };
    // Budget 1: only the root (depth 0) fits => maxDepth 0 => nothing expanded.
    const m = build(data, 1);
    expect(m.expanded.size).toBe(0);
    expect(m.rows.map((r) => r.path)).toEqual(["$"]);
  });

  it("a larger budget expands more levels, breadth-first", () => {
    const data: Json = { l1a: { l2: 1 }, l1b: { l2: 2 } };
    // Depth 0 = 1 node (root). Depth 1 = 2 nodes. Depth 2 = 2 nodes.
    // Budget 3 fits depths 0+1 (cumulative 3) but not depth 2 (cumulative 5),
    // so maxDepth = 1: only the root is expanded, its children stay collapsed.
    const m = build(data, 3);
    expect(m.expanded.has("$")).toBe(true);
    expect(m.expanded.has('$["l1a"]')).toBe(false);
    expect(m.expanded.has('$["l1b"]')).toBe(false);
  });

  it("with an ample budget the whole document expands", () => {
    const m = build({ a: { b: { c: 1 } } }, 100000);
    expect(m.expanded.has("$")).toBe(true);
    expect(m.expanded.has('$["a"]')).toBe(true);
    expect(m.expanded.has('$["a"]["b"]')).toBe(true);
  });
});

describe("expandLevel / collapseLevel step behavior", () => {
  it("expandLevel opens the current frontier one layer at a time", () => {
    const data: Json = { a: { b: { c: 1 } } };
    const m = new TreeModel(data, Infinity);
    m.rebuildRows(); // start fully collapsed (only root)
    expect(m.rows.length).toBe(1);

    expect(m.expandLevel()).toEqual({ ok: true }); // open root
    expect(m.expanded.has("$")).toBe(true);
    expect(m.expanded.has('$["a"]')).toBe(false);

    expect(m.expandLevel()).toEqual({ ok: true }); // open $["a"]
    expect(m.expanded.has('$["a"]')).toBe(true);
    expect(m.expanded.has('$["a"]["b"]')).toBe(false);
  });

  it("collapseLevel closes the innermost open layer first", () => {
    const data: Json = { a: { b: { c: 1 } } };
    const m = build(data, 100000); // fully expanded
    expect(m.expanded.has('$["a"]["b"]')).toBe(true);

    m.collapseLevel(); // close innermost ($["a"]["b"])
    expect(m.expanded.has('$["a"]["b"]')).toBe(false);
    expect(m.expanded.has('$["a"]')).toBe(true);

    m.collapseLevel(); // close $["a"]
    expect(m.expanded.has('$["a"]')).toBe(false);
    expect(m.expanded.has("$")).toBe(true);

    m.collapseLevel(); // fold the root
    expect(m.expanded.has("$")).toBe(false);
    expect(m.rows.length).toBe(1);
  });

  it("expandLevel is a no-op returning ok when everything is expanded", () => {
    const m = build({ a: 1 }, 100000);
    const before = shape(m.rows);
    expect(m.expandLevel()).toEqual({ ok: true });
    expect(shape(m.rows)).toEqual(before);
  });

  it("canExpand / canCollapse reflect available steps", () => {
    const m = new TreeModel({ a: { b: 1 } }, Infinity);
    m.rebuildRows(); // collapsed
    expect(m.canExpand()).toBe(true);
    expect(m.canCollapse()).toBe(false);

    m.expandLevel();
    expect(m.canCollapse()).toBe(true);
  });
});

describe("parentIndexOf", () => {
  it("returns the structural parent of a nested node", () => {
    const m = build({ a: [10, 20] });
    const child = m.rows.findIndex((r) => r.path === '$["a"][1]');
    const parent = m.parentIndexOf(child);
    expect(m.rows[parent].path).toBe('$["a"]');
  });

  it("returns -1 for the root row", () => {
    const m = build({ a: 1 });
    expect(m.parentIndexOf(0)).toBe(-1);
  });

  it("skips closing rows when scanning upward", () => {
    // Two sibling containers; the second's parent must be the root, not the
    // first container's closing bracket sitting just above it.
    const m = build({ a: [1], b: [2] });
    const bIdx = m.rows.findIndex((r) => r.path === '$["b"]');
    // Confirm a closing row sits directly above $["b"] (close of $["a"]).
    expect(m.rows[bIdx - 1].closing).toBe(true);
    expect(m.rows[m.parentIndexOf(bIdx)].path).toBe("$");
  });

  it("gives a closing row the same parent as its opening container", () => {
    const m = build({ a: { b: 1 } });
    const closeA = m.rows.findIndex((r) => r.closing && r.path === '$["a"] )');
    expect(m.rows[m.parentIndexOf(closeA)].path).toBe("$");
  });
});
