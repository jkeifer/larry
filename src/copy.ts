// Copy / selection feature, extracted from JsonView for isolation and — for
// the one tricky pure bit, selectionToJson — unit testability
// (test/unit/copy.test.ts).
//
// selectionToJson is pure (rows + a parentIndexOf function in, a string out),
// so it lives here as a standalone export rather than as a method reaching
// into `this`. CopyController wraps the three DOM-coupled affordances
// (per-row copy, per-row copy-path, and the cross-row `copy` event handler)
// that surround it; they depend only on the on-screen rows/canvas plus
// pathToJq, so a tiny deps interface keeps them off JsonView.

import { pathToJq } from "./core";
import { Row } from "./tree-model";

// Pretty-printed JSON for a set of selected row indices. Only the top-level
// nodes of the selection matter — a node with a selected ancestor is already
// contained in that ancestor's output. A single resolved node copies as
// clean valid JSON; several siblings copy as an object/array fragment.
//
// Pure: `rows` is the flattened row list, `indices` the selected rows (sorted
// or not), and `parentIndexOf` the model's structural-parent lookup. No DOM.
export function selectionToJson(
  rows: readonly Row[],
  indices: number[],
  parentIndexOf: (index: number) => number,
): string {
  const selected = new Set(indices);
  const hasSelectedAncestor = (i: number): boolean => {
    for (let p = parentIndexOf(i); p !== -1; p = parentIndexOf(p)) if (selected.has(p)) return true;
    return false;
  };
  const roots = indices.filter((i) => !hasSelectedAncestor(i));
  if (roots.length === 1) return JSON.stringify(rows[roots[0]].value, null, 2);
  return roots
    .map((i) => {
      const row = rows[i];
      const value = JSON.stringify(row.value, null, 2);
      const parent = parentIndexOf(i);
      const parentKind = parent === -1 ? null : rows[parent].kind;
      return row.label !== null && parentKind === "object"
        ? `${JSON.stringify(row.label)}: ${value}`
        : value;
    })
    .join(",\n");
}

// The (small) DOM surface CopyController needs: the current row list, the
// canvas element the visible rows are rendered into, and the model's
// structural-parent lookup (for resolving selection roots).
export interface CopyDeps {
  getRows: () => readonly Row[];
  getCanvas: () => HTMLElement;
  parentIndexOf: (index: number) => number;
}

export class CopyController {
  constructor(private readonly deps: CopyDeps) {}

  // Per-row: copy this node's entire subtree, however large, as pretty JSON.
  async copyNode(index: number, el: HTMLElement): Promise<void> {
    const row = this.deps.getRows()[index];
    if (!row) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(row.value, null, 2));
      el.classList.add("jv-copied");
      setTimeout(() => el.classList.remove("jv-copied"), 900);
    } catch {
      /* clipboard blocked by the page context; nothing safe to do */
    }
  }

  // Per-row: copy the jq expression that selects this node (e.g. .links[3].href).
  async copyPath(index: number, el: HTMLElement): Promise<void> {
    const row = this.deps.getRows()[index];
    if (!row) return;
    try {
      await navigator.clipboard.writeText(pathToJq(row.path));
      el.classList.add("jv-copied");
      setTimeout(() => el.classList.remove("jv-copied"), 900);
    } catch {
      /* clipboard blocked by the page context; nothing safe to do */
    }
  }

  // Selecting across rows and copying yields pretty-printed JSON of the
  // selected nodes, with real-space indentation, not the on-screen glyphs.
  onCopy(e: ClipboardEvent): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    // A selection sitting entirely inside one text node is a substring copy
    // (e.g. part of a string value) — leave that to the browser untouched.
    if (sel.anchorNode === sel.focusNode && sel.anchorNode?.nodeType === Node.TEXT_NODE) {
      return;
    }

    // Which rendered rows does the selection touch? (Off-screen rows do not
    // exist in the DOM — for those, use the per-row copy affordance.)
    const rows = this.deps.getRows();
    const indices: number[] = [];
    this.deps.getCanvas().querySelectorAll<HTMLElement>(".jv-row").forEach((el) => {
      if (sel.containsNode(el, true)) {
        const i = Number(el.dataset.index);
        if (!Number.isNaN(i) && !rows[i]?.closing) indices.push(i);
      }
    });
    if (indices.length === 0) return;

    indices.sort((a, b) => a - b);
    e.clipboardData?.setData("text/plain", selectionToJson(rows, indices, this.deps.parentIndexOf));
    e.preventDefault();
  }
}
