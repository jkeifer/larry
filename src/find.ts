// In-tree find feature, extracted from JsonView for isolation and file-size
// reduction. This controller is deliberately DOM-coupled — it owns the find
// bar, input, and count, and drives highlight/scroll — because its value here
// is separating a whole feature out of JsonView, not DOM-free purity (the pure
// matching rule already lives in core.searchableText).
//
// JsonView keeps scrollIndexIntoView (shared with keyboard focus) and passes
// it in; the controller never scrolls the viewport directly.

import { searchableText, tickPositions } from "./core";
import { Row } from "./tree-model";
import { button } from "./dom";

// The small, explicit surface the controller needs from JsonView. It reads the
// current rows, asks JsonView to repaint (highlight classes) after matching
// changes, and delegates scrolling a matched row into view (the same routine
// keyboard focus uses, so it stays on JsonView rather than being duplicated).
// scrollToFraction (empty-gutter clicks) and scrollbarWidth (inset the gutter
// flush-left of the native scrollbar) keep all viewport geometry on JsonView.
export interface FindDeps {
  getRows: () => readonly Row[];
  scheduleRender: () => void;
  scrollIndexIntoView: (index: number) => void;
  scrollToFraction: (fraction: number) => void;
  scrollbarWidth: () => number;
}

export class FindController {
  private findQuery = "";
  private findMatches: number[] = [];
  private findMatchSet = new Set<number>();
  private findPos = -1;
  private findBar!: HTMLElement;
  private findInput!: HTMLInputElement;
  private findCount!: HTMLElement;
  private findGutter!: HTMLElement;

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

  // The scrollbar match gutter: a thin strip pinned to the right edge of the
  // tree, carrying one tick per match position so you can see, at a glance,
  // where matches sit across the whole (virtualized) document. Clicking a tick
  // jumps to that match; clicking elsewhere scrolls the viewport to that
  // fraction. Only visible while a find has matches. Lives in the same
  // non-scrolling wrapper as the find bar (see JsonView.mount).
  buildGutter(): HTMLElement {
    const g = this.findGutter = document.createElement("div");
    g.className = "jv-find-gutter";
    g.title = "Find matches — click to jump";
    g.addEventListener("click", (e) => this.onGutterClick(e));
    return g;
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
    this.renderGutter();
    this.deps.scheduleRender();
  }

  // Re-place the gutter ticks after a viewport resize — their pixel offsets
  // depend on the track height, which changes with the window. Cheap no-op
  // while find is inactive (renderGutter clears on an empty match set).
  reflowGutter(): void {
    this.renderGutter();
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
    this.renderGutter();
    if (this.findPos >= 0) this.scrollToMatch();
    this.deps.scheduleRender(); // repaint highlight classes
  }

  private stepFind(dir: number): void {
    if (!this.findMatches.length) return;
    this.findPos = (this.findPos + dir + this.findMatches.length) % this.findMatches.length;
    this.updateFindCount();
    this.renderGutter();
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

  // Paint the match ticks. Positions depend only on the match set and row
  // count (not scroll), so this runs on match changes and resize — never on
  // scroll. Bounded DOM: tickPositions dedupes to whole pixels, and the
  // current match gets one extra, distinct tick drawn on top.
  private renderGutter(): void {
    const g = this.findGutter;
    if (!g) return;
    const n = this.deps.getRows().length;
    if (!this.findMatches.length || !n) {
      g.classList.remove("jv-open");
      g.replaceChildren();
      return;
    }
    g.classList.add("jv-open");
    g.style.right = `${this.deps.scrollbarWidth()}px`;
    const trackH = g.clientHeight;
    const frag = document.createDocumentFragment();
    for (const y of tickPositions(this.findMatches, n, trackH)) {
      const tick = document.createElement("div");
      tick.className = "jv-find-tick";
      tick.style.top = `${y}px`;
      frag.appendChild(tick);
    }
    const currentIdx = this.findMatches[this.findPos];
    if (currentIdx != null && trackH > 0) {
      const cur = document.createElement("div");
      cur.className = "jv-find-tick jv-find-tick-current";
      cur.style.top = `${Math.round((currentIdx / n) * (trackH - 1))}px`;
      frag.appendChild(cur);
    }
    g.replaceChildren(frag);
  }

  // Click on the gutter: jump to the nearest match within a few px, else scroll
  // the viewport to the clicked fraction. The nearest-match search is over the
  // match indices (not the deduped ticks) so it lands on a real match.
  private onGutterClick(e: MouseEvent): void {
    if (!this.findMatches.length) return;
    const rect = this.findGutter.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const trackH = rect.height;
    if (trackH <= 0) return;
    const n = this.deps.getRows().length || 1;
    let best = -1;
    let bestDist = Infinity;
    for (let k = 0; k < this.findMatches.length; k++) {
      const d = Math.abs((this.findMatches[k] / n) * (trackH - 1) - y);
      if (d < bestDist) { bestDist = d; best = k; }
    }
    const HIT_SLOP = 6; // px
    if (best >= 0 && bestDist <= HIT_SLOP) {
      this.findPos = best;
      this.updateFindCount();
      this.renderGutter();
      this.scrollToMatch();
      this.deps.scheduleRender();
    } else {
      this.deps.scrollToFraction(y / trackH);
    }
  }
}
