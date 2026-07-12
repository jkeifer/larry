// Pure, DOM-free row/expansion engine — unit-tested in
// test/unit/tree-model.test.ts.
//
// This owns the flattened, virtualization-ready row list and the set of
// expanded container paths. It has NO knowledge of the DOM: it never renders,
// scrolls, or alerts. When an operation is refused because it would blow the
// row cap, it returns a typed result and lets the caller (JsonView) decide how
// to surface that (today: an alert). Keeping this layer DOM-free is what makes
// the expansion logic unit-testable.

import {
  Json,
  Kind,
  kindOf,
  isContainer,
  childCountOf,
  entriesOf,
  childPath,
  spliceInto,
} from "./core";

export interface Row {
  path: string;          // stable id, e.g. $["a"][0]
  label: string | null;  // object key or array index, null for the root row
  value: Json;
  depth: number;
  kind: Kind;
  expandable: boolean;
  childCount: number;
  closing?: boolean;     // synthetic "]" / "}" row that closes an expanded container
}

// Result of an expand attempt. `ok: false` means the model refused because the
// operation would have materialized past EXPAND_CAP rows; `wouldAdd` is the
// number of rows it would have added, so the caller can compose an accurate
// message. No mutation happens on a refusal.
export type ExpandResult = { ok: true } | { ok: false; wouldAdd: number };

// Fully expand on load unless it would exceed this many rows.
export const ROW_BUDGET = 100000;
// Refuse a single expand/step that would materialize past this many rows.
export const EXPAND_CAP = 200000;

export class TreeModel {
  private data: Json;
  readonly expanded = new Set<string>();
  private _rows: Row[] = [];

  // Caps are injectable so tests can trip the budgeting/refusal logic with
  // small documents; production uses the module defaults.
  constructor(
    data: Json,
    private readonly rowBudget: number = ROW_BUDGET,
    private readonly expandCap: number = EXPAND_CAP,
  ) {
    this.data = data;
  }

  // Read access for the DOM layer (sizer height, rendering, find/focus).
  get rows(): readonly Row[] {
    return this._rows;
  }

  // Reset to a new value: fresh expansion state auto-fitted to the budget, and
  // a rebuilt row list. Mirrors the old JsonView.showData reset.
  setData(data: Json): void {
    this.data = data;
    this.expanded.clear();
    this.autoExpand();
    this.rebuildRows();
  }

  private makeRow(path: string, label: string | null, value: Json, depth: number): Row {
    const kind = kindOf(value);
    return {
      path,
      label,
      value,
      depth,
      kind,
      expandable: isContainer(kind) && childCountOf(value, kind) > 0,
      childCount: childCountOf(value, kind),
    };
  }

  // A container's closing bracket, rendered as its own row at the container's
  // depth so an expanded object/array reads `{ … }` with a matching brace.
  private closeRow(row: Row): Row {
    return {
      path: row.path + " )",
      label: null,
      value: null,
      depth: row.depth,
      kind: row.kind,
      expandable: false,
      childCount: 0,
      closing: true,
    };
  }

  // The single definition of "what expanding a container appends": its children
  // (honoring nested expanded state) followed by its own closing bracket.
  private expandInto(row: Row, out: Row[]): void {
    for (const [label, child] of entriesOf(row.value, row.kind)) {
      this.materialize(this.makeRow(childPath(row.path, label, row.kind), label, child, row.depth + 1), out);
    }
    out.push(this.closeRow(row));
  }

  // Depth-first materialization honoring the current `expanded` set.
  private materialize(row: Row, out: Row[]): void {
    out.push(row);
    if (!row.expandable || !this.expanded.has(row.path)) return;
    this.expandInto(row, out);
  }

  rebuildRows(): void {
    const out: Row[] = [];
    this.materialize(this.makeRow("$", null, this.data, 0), out);
    this._rows = out;
  }

  // Expand or collapse the container at `index`. On expand, refuses (returning
  // `{ ok: false, wouldAdd }`) if it would push the visible list past the cap,
  // leaving rows untouched. Collapse always succeeds. A no-op (leaf / closing /
  // out-of-range row) returns `{ ok: true }` without mutating.
  toggle(index: number): ExpandResult {
    const row = this._rows[index];
    if (!row || !row.expandable) return { ok: true };

    if (this.expanded.has(row.path)) {
      // Collapse: drop the descendant block plus this container's close row.
      this.expanded.delete(row.path);
      let end = index + 1;
      while (end < this._rows.length && this._rows[end].depth > row.depth) end++;
      if (end < this._rows.length && this._rows[end].closing && this._rows[end].depth === row.depth) end++;
      this._rows.splice(index + 1, end - (index + 1));
      return { ok: true };
    }

    // Expand: refuse if this one node would explode the visible list.
    if (this._rows.length + row.childCount > this.expandCap) {
      return { ok: false, wouldAdd: row.childCount };
    }
    // Materialize children (honoring any nested expanded state), then this
    // container's own closing bracket.
    this.expanded.add(row.path);
    const sub: Row[] = [];
    this.expandInto(row, sub);
    spliceInto(this._rows, index + 1, sub);
    return { ok: true };
  }

  autoExpand(): void {
    // Fully expand by default. Virtualization bounds the DOM, but neither the
    // row model nor the sizer height is bounded, so we only fall back to
    // collapsing when a full expansion would materialize more than the budget.
    // In that case we keep the shallowest levels — which show the document's
    // overall shape — and leave the deepest levels collapsed.
    this.markToDepth(this.data, "$", 0, this.fitDepth(this.rowBudget));
  }

  // Largest depth D such that the node count at depth <= D fits `budget`
  // (Infinity when the whole document fits). Walked breadth-first so a huge
  // document stops early instead of counting every node.
  private fitDepth(budget: number): number {
    let cumulative = 0;
    let level: Json[] = [this.data];
    let depth = 0;
    while (level.length) {
      cumulative += level.length;
      if (cumulative > budget) return Math.max(0, depth - 1);
      const next: Json[] = [];
      for (const v of level) {
        const k = kindOf(v);
        if (isContainer(k)) for (const [, child] of entriesOf(v, k)) next.push(child);
      }
      level = next;
      depth++;
    }
    return Infinity; // whole document fits within the budget
  }

  // Mark every non-empty container shallower than `maxDepth` as expanded.
  private markToDepth(v: Json, path: string, d: number, maxDepth: number): void {
    const k = kindOf(v);
    if (!isContainer(k) || childCountOf(v, k) === 0 || d >= maxDepth) return;
    this.expanded.add(path);
    for (const [label, child] of entriesOf(v, k)) {
      this.markToDepth(child, childPath(path, label, k), d + 1, maxDepth);
    }
  }

  // Open the outer edge one layer deeper: every collapsed container that is
  // currently visible becomes expanded. Repeated presses unfold the tree.
  // Returns `{ ok: false, wouldAdd }` (leaving state untouched) if the step
  // would push past the cap; `{ ok: true }` otherwise (including a no-op when
  // everything is already expanded).
  expandLevel(): ExpandResult {
    const frontier = this._rows.filter((r) => r.expandable && !this.expanded.has(r.path));
    if (frontier.length === 0) return { ok: true }; // already fully expanded
    const added = frontier.reduce((sum, r) => sum + r.childCount, 0);
    if (this._rows.length + added > this.expandCap) {
      return { ok: false, wouldAdd: added };
    }
    for (const r of frontier) this.expanded.add(r.path);
    this.rebuildRows();
    return { ok: true };
  }

  // Close the innermost open layer: every expanded container with no expanded
  // container beneath it (the root included, so it can fold to one line). One
  // DFS pass, tracking per-container whether it holds an expanded descendant.
  collapseLevel(): void {
    const innermost: Row[] = [];
    const stack: { row: Row; hasExpandedChild: boolean }[] = [];
    const drain = (untilDepth: number): void => {
      while (stack.length && untilDepth <= stack[stack.length - 1].row.depth) {
        const top = stack.pop()!;
        if (!top.hasExpandedChild) innermost.push(top.row);
      }
    };
    for (const r of this._rows) {
      drain(r.depth);
      if (r.expandable && this.expanded.has(r.path)) {
        if (stack.length) stack[stack.length - 1].hasExpandedChild = true;
        stack.push({ row: r, hasExpandedChild: false });
      }
    }
    drain(-1);

    if (innermost.length === 0) return; // nothing is expanded
    for (const r of innermost) this.expanded.delete(r.path);
    this.rebuildRows();
  }

  // Whether the Expand/Collapse steppers have anything left to do.
  canExpand(): boolean {
    for (const r of this._rows) {
      if (r.expandable && !this.expanded.has(r.path)) return true;
    }
    return false;
  }

  canCollapse(): boolean {
    for (const r of this._rows) {
      if (r.expandable && this.expanded.has(r.path)) return true;
    }
    return false;
  }

  // The nearest shallower non-closing row above `index` — its structural
  // parent — or -1 if none. A backward scan (never a cached field): `toggle`
  // splices `rows`, so any stored absolute index would go stale.
  parentIndexOf(index: number): number {
    const d = this._rows[index].depth;
    for (let j = index - 1; j >= 0; j--) {
      if (this._rows[j].closing) continue;
      if (this._rows[j].depth < d) return j;
    }
    return -1;
  }
}
