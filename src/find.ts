// In-tree find feature, extracted from JsonView for isolation and file-size
// reduction. This controller is deliberately DOM-coupled — it owns the find
// bar, input, and count, and drives highlight/scroll — because its value here
// is separating a whole feature out of JsonView, not DOM-free purity (the pure
// matching rule already lives in core.searchableText).
//
// JsonView keeps scrollIndexIntoView (shared with keyboard focus) and passes
// it in; the controller never scrolls the viewport directly.

import { searchableText } from "./core";
import { Row } from "./tree-model";
import { button } from "./dom";

// The small, explicit surface the controller needs from JsonView. It reads the
// current rows, asks JsonView to repaint (highlight classes) after matching
// changes, and delegates scrolling a matched row into view (the same routine
// keyboard focus uses, so it stays on JsonView rather than being duplicated).
export interface FindDeps {
  getRows: () => readonly Row[];
  scheduleRender: () => void;
  scrollIndexIntoView: (index: number) => void;
}

export class FindController {
  private findQuery = "";
  private findMatches: number[] = [];
  private findMatchSet = new Set<number>();
  private findPos = -1;
  private findBar!: HTMLElement;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLElement;

  constructor(private readonly deps: FindDeps) {}

  // ---- Highlight queries (used by renderRow) -----------------------------
  // O(1) membership against findMatchSet, kept in lockstep with findMatches
  // (indices always refer to the freshly rebuilt row set — refresh() re-runs
  // on every row-set change).
  isHit(index: number): boolean {
    return this.findMatches.length > 0 && this.findMatchSet.has(index);
  }

  isCurrent(index: number): boolean {
    return this.findMatches.length > 0 && this.findMatches[this.findPos] === index;
  }

  // ---- DOM ---------------------------------------------------------------
  buildBar(): HTMLElement {
    const bar = this.findBar = document.createElement("div");
    bar.className = "jv-find";
    const input = this.findInput = document.createElement("input");
    input.type = "text";
    input.className = "jv-find-input";
    input.placeholder = "find in view";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.autocapitalize = "off";
    input.addEventListener("input", () => { this.findQuery = input.value; this.runFind(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.stepFind(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    const count = this.findCount = document.createElement("span");
    count.className = "jv-find-count";
    const prev = button("↑", () => this.stepFind(-1));
    prev.title = "Previous match (Shift+Enter)";
    const next = button("↓", () => this.stepFind(1));
    next.title = "Next match (Enter)";
    const close = button("✕", () => this.close());
    close.title = "Close (Esc)";
    bar.append(input, count, prev, next, close);
    return bar;
  }

  // ---- Public surface for JsonView ---------------------------------------
  open(): void {
    this.findBar.classList.add("jv-open");
    this.findInput.focus();
    this.findInput.select();
  }

  close(): void {
    this.findBar.classList.remove("jv-open");
    this.findQuery = "";
    this.findInput.value = "";
    this.findMatches = [];
    this.findMatchSet.clear();
    this.findPos = -1;
    this.updateFindCount();
    this.deps.scheduleRender();
  }

  // Re-run matching against the current rows. A no-op (beyond clearing) when
  // the query is empty, so JsonView can call this unconditionally wherever a
  // row-set change happens.
  refresh(): void {
    if (this.findQuery.trim()) this.runFind();
  }

  // ---- Internals ---------------------------------------------------------
  // The lowercased haystack matched against the query. Closing rows never
  // match; the pure rule lives in core.searchableText for unit testing.
  private rowSearchText(row: Row): string {
    if (row.closing) return "";
    return searchableText(row.label, row.kind, row.value);
  }

  private runFind(): void {
    const q = this.findQuery.trim().toLowerCase();
    const rows = this.deps.getRows();
    this.findMatches = [];
    this.findMatchSet.clear();
    if (q) {
      for (let i = 0; i < rows.length; i++) {
        if (this.rowSearchText(rows[i]).includes(q)) {
          this.findMatches.push(i);
          this.findMatchSet.add(i);
        }
      }
    }
    this.findPos = this.findMatches.length ? 0 : -1;
    this.updateFindCount();
    if (this.findPos >= 0) this.scrollToMatch();
    this.deps.scheduleRender(); // repaint highlight classes
  }

  private stepFind(dir: number): void {
    if (!this.findMatches.length) return;
    this.findPos = (this.findPos + dir + this.findMatches.length) % this.findMatches.length;
    this.updateFindCount();
    this.scrollToMatch();
    this.deps.scheduleRender();
  }

  private updateFindCount(): void {
    const n = this.findMatches.length;
    this.findCount.textContent = n ? `${this.findPos + 1}/${n}` : (this.findQuery.trim() ? "0/0" : "");
  }

  private scrollToMatch(): void {
    const idx = this.findMatches[this.findPos];
    if (idx != null) this.deps.scrollIndexIntoView(idx);
  }
}
