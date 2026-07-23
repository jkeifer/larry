/*
 * larry — a trustworthy JSON viewer. Content script.
 *
 * Design goals (in priority order):
 *   1. Auditable: one file, zero runtime dependencies, no chrome.* APIs, no
 *      permissions. Everything that runs is in front of you.
 *   2. Handles tens of MB: the DOM is the only real enemy, so the tree is
 *      *virtualized* — only the ~60 rows in the viewport exist as elements.
 *      Containers are collapsed by default, so nothing large is materialized
 *      until you ask for it.
 *   3. Does nothing on non-JSON pages: it returns immediately unless the
 *      response Content-Type ends in "json".
 *
 * On parsing: we parse on the main thread, not in a Worker. For tens of MB
 * JSON.parse costs a few hundred ms once, whereas structured-cloning the parsed
 * tree back out of a Worker often costs *more* than the parse it was meant to
 * offload. Since rendering is lazy, JSON.parse is the only unavoidable full
 * pass, so we run it directly and just yield one paint first so the loading
 * state shows. (If you ever need hundreds of MB, the upgrade is a Worker that
 * parses into a transferable ArrayBuffer index — noted in the README.)
 */

// jqjs, loaded as the first content script (see manifest), exposes its API on
// the global. Pure JS, no eval — `compile(prog)` returns a generator function.
declare const jqjs: {
  compile(program: string): (input: unknown) => Iterable<unknown>;
};

import {
  Json,
  kindOf,
  formatBytes,
  URL_RE,
  tryParseNdjson,
  startsWithJsonChar,
} from "./core";
import { Row, TreeModel } from "./tree-model";
import { FindController } from "./find";
import { CopyController } from "./copy";
import { text, button, spacer, flash } from "./dom";

(() => {
  "use strict";

  // ---- Activation gate -----------------------------------------------------
  const contentType = (document.contentType || "").toLowerCase();
  const looksLikeJson = contentType === "application/json" || contentType.endsWith("+json");

  // Forced-activation fallback: some servers (and all file:// pages saved
  // with the "wrong" extension) serve raw JSON/NDJSON with a non-JSON
  // content-type (commonly text/plain). If the content-type gate alone
  // rejected those, larry would never run. So when the content-type doesn't
  // look like JSON, we additionally probe whether the page *body* looks like
  // a lone JSON/NDJSON payload — cheap, and false on ordinary HTML (which has
  // many top-level elements).
  if (!looksLikeJson && !looksLikeLoneJsonBody()) return;

  // True when the page is very likely a raw JSON/NDJSON payload served with a
  // non-JSON content-type: a body that is empty (still loading) or a single
  // text/<pre> node whose trimmed content starts with { [ or " . Cheap on
  // HTML pages (bails on element count before ever touching text content).
  //
  // Runs twice in the forced (non-JSON-content-type) path: once here at
  // document_start — where the body is typically still empty, so this
  // conservatively returns true and defers the real decision — and again in
  // activate() once the body is populated, which is what actually decides
  // whether to proceed. See the pre-getRawText guard in activate() for why
  // that second check is load-bearing.
  function looksLikeLoneJsonBody(): boolean {
    const body = document.body;
    if (!body) return true; // document_start: decide later in activate()
    if (body.childElementCount > 1) return false;
    const el = body.firstElementChild;
    if (el && el.tagName !== "PRE") return false;
    const text = el?.textContent ?? body.textContent ?? "";
    return startsWithJsonChar(text);
  }

  // Add the marker synchronously (we are at document_start) so content.css can
  // hide the browser's raw text node before it paints — no flash.
  document.documentElement.classList.add("jv-active");

  const run = () => activate().catch(fatal);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  // ---- Constants -----------------------------------------------------------
  // (The Row model, expansion state, and its ROW_BUDGET/EXPAND_CAP caps live in
  // the DOM-free TreeModel; these are the rendering/query concerns that stay.)
  const ROW_H = 20;        // px, fixed so virtualization needs no measurement
  const INDENT = 16;       // px per depth level
  const OVERSCAN = 12;     // rows rendered above/below the viewport
  const QUERY_CAP = 200000;  // stop collecting jq outputs past this (guards runaway streams)
  const STR_MAX = 200;     // chars shown before a long string is truncated

  // ---- Helpers -------------------------------------------------------------
  const nextPaint = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  // ---- The viewer ----------------------------------------------------------
  class JsonView {
    private data: Json;
    private raw: string;
    private model: TreeModel;

    private scroller!: HTMLDivElement;   // the scroll viewport
    private sizer!: HTMLDivElement;      // full-height spacer
    private canvas!: HTMLDivElement;     // holds the visible slice
    private rawPre: HTMLPreElement | null = null;
    private showingRaw = false;
    private viewingResult = false;   // true while a jq result (not the original) is shown
    private renderScheduled = false;
    private collapseBtn!: HTMLButtonElement;
    private expandBtn!: HTMLButtonElement;
    private readonly original: Json;   // the parsed document, before any jq query
    private queryInput!: HTMLInputElement;
    private queryStatus!: HTMLElement;
    private clearBtn!: HTMLButtonElement;
    private queryRunId = 0;
    private readonly note: string;

    // ---- Find & copy (in their own modules) --------------------------------
    // scrollIndexIntoView stays on JsonView (shared with keyboard focus) and is
    // passed into the find controller; the copy controller reads the on-screen
    // rows/canvas plus the model's parent lookup.
    private readonly find: FindController;
    private readonly copy: CopyController;

    // ---- Keyboard focus (virtual — real DOM focus fights virtualization) --
    private focusIndex = 0;
    private navActive = false;   // true once the user presses a nav key; gates the focus ring

    constructor(data: Json, raw: string, note = "") {
      this.data = data;
      this.original = data;
      this.raw = raw;
      this.note = note;
      this.model = new TreeModel(data);
      this.find = new FindController({
        getRows: () => this.rows,
        scheduleRender: () => this.scheduleRender(),
        scrollIndexIntoView: (i) => this.scrollIndexIntoView(i),
      });
      this.copy = new CopyController({
        getRows: () => this.rows,
        getCanvas: () => this.canvas,
        parentIndexOf: (i) => this.model.parentIndexOf(i),
      });
    }

    // Read-only view of the model's flattened row list. JsonView drives find,
    // focus, rendering, and the sizer height off this; all mutation goes
    // through the model's toggle/expand/collapse methods.
    private get rows(): readonly Row[] {
      return this.model.rows;
    }

    mount(): void {
      document.title = document.title || "JSON";
      const app = document.createElement("div");
      app.className = "jv-app";
      const tree = this.buildTree();
      // The find bar lives in a non-scrolling wrapper around the scroller (the
      // wrapper is the position:relative context) so it stays pinned to the
      // top-right corner instead of scrolling away with the tree content when a
      // match scrolls the viewport.
      const treeWrap = document.createElement("div");
      treeWrap.className = "jv-tree-wrap";
      treeWrap.append(tree, this.find.buildBar());
      app.append(this.buildToolbar(), this.buildQueryBar(), treeWrap);

      // Replace the page body wholesale with our UI.
      const body = document.body || document.documentElement.appendChild(document.createElement("body"));
      body.textContent = "";
      body.appendChild(app);

      // Commandeer Cmd/Ctrl+F: native find can't see virtualized rows, so we
      // suppress it and open larry's own in-tree find instead.
      window.addEventListener("keydown", (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "f" || e.key === "F")) {
          e.preventDefault();
          this.find.open();
        }
      });

      // Keyboard tree navigation. Separate listener from the find intercept
      // above — they coexist independently. Ignore keys while typing in the
      // jq/find inputs (or any other input/textarea) so navigation never
      // fights text entry.
      window.addEventListener("keydown", (e) => {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter"].includes(e.key)) return;
        e.preventDefault();
        // Reveal the focus ring on first use — it's hidden until the user
        // actually starts navigating, so it doesn't sit on the root at load.
        this.navActive = true;
        switch (e.key) {
          case "ArrowDown": this.moveFocus(1); break;
          case "ArrowUp": this.moveFocus(-1); break;
          case "ArrowRight": this.focusExpand(); break;
          case "ArrowLeft": this.focusCollapse(); break;
          case "Enter": this.toggle(this.focusIndex); break;
        }
        this.scheduleRender(); // ensure the ring appears even if focus didn't move
      });

      this.model.autoExpand();
      this.model.rebuildRows();
      this.syncSizerHeight();
      this.updateButtons();
      this.scheduleRender();
    }

    // Keep the full-height spacer in sync with the current row count so the
    // scrollbar reflects the whole (virtualized) list.
    private syncSizerHeight(): void {
      if (this.sizer) this.sizer.style.height = `${this.rows.length * ROW_H}px`;
    }

    // Disable a stepper when it has nothing left to do: Expand when every
    // container is open, Collapse when none is. Recomputed only on expansion
    // changes (never on scroll), so the short-circuiting scans stay cheap.
    private updateButtons(): void {
      this.expandBtn.disabled = !this.model.canExpand();
      this.collapseBtn.disabled = !this.model.canCollapse();
    }

    // ---- Chrome ------------------------------------------------------------
    private buildToolbar(): HTMLElement {
      const bar = document.createElement("div");
      bar.className = "jv-toolbar";

      const size = new Blob([this.raw]).size;
      const info = document.createElement("span");
      info.className = "jv-info";
      info.textContent = `${kindOf(this.data)} · ${formatBytes(size)}${this.note ? " · " + this.note : ""}`;

      const collapseBtn = this.collapseBtn = button("Collapse level", () => this.collapseLevel());
      const expandBtn = this.expandBtn = button("Expand level", () => this.expandLevel());
      const rawBtn = button("View raw", () => this.toggleRaw(rawBtn));
      const copyBtn = button("Copy", async () => {
        try {
          await navigator.clipboard.writeText(this.currentText());
          flash(copyBtn, "Copied");
        } catch {
          flash(copyBtn, "Copy failed");
        }
      });

      bar.append(info, spacer(), collapseBtn, expandBtn, rawBtn, copyBtn);
      return bar;
    }

    private buildTree(): HTMLElement {
      this.scroller = document.createElement("div");
      this.scroller.className = "jv-scroller";
      this.scroller.setAttribute("role", "tree");
      this.scroller.tabIndex = 0;
      this.sizer = document.createElement("div");
      this.sizer.className = "jv-sizer";
      this.canvas = document.createElement("div");
      this.canvas.className = "jv-canvas";
      this.sizer.appendChild(this.canvas);
      this.scroller.appendChild(this.sizer);

      this.scroller.addEventListener("scroll", () => this.scheduleRender(), { passive: true });
      window.addEventListener("resize", () => this.scheduleRender(), { passive: true });

      // One delegated click handler for every caret in the (recycled) rows.
      this.scroller.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const rowEl = target.closest<HTMLElement>(".jv-row");
        if (!rowEl) return;
        const index = Number(rowEl.dataset.index);
        if (Number.isNaN(index)) return;

        const copyEl = target.closest<HTMLElement>(".jv-copy");
        if (copyEl) {
          this.copy.copyNode(index, copyEl);
          return;
        }

        const copyPathEl = target.closest<HTMLElement>(".jv-copypath");
        if (copyPathEl) {
          this.copy.copyPath(index, copyPathEl);
          return;
        }

        const more = target.closest<HTMLElement>(".jv-str-more");
        if (more) {
          const str = more.parentElement!;
          str.classList.toggle("jv-expanded");
          more.textContent = str.classList.contains("jv-expanded") ? " show less" : "…show";
        } else if (target.closest(".jv-caret") || target.closest(".jv-key")) {
          this.toggle(index);
        }
      });

      // Selecting across rows and copying yields pretty-printed JSON of the
      // selected nodes, with real-space indentation, not the on-screen glyphs.
      this.scroller.addEventListener("copy", (e) => this.copy.onCopy(e as ClipboardEvent));

      return this.scroller;
    }

    // ---- Query bar (jq via jqjs) ------------------------------------------
    private buildQueryBar(): HTMLElement {
      const wrap = document.createElement("div");
      wrap.className = "jv-query";

      const input = this.queryInput = document.createElement("input");
      input.type = "text";
      input.className = "jv-query-input";
      input.placeholder = "jq filter — e.g.  .links[] | .href      (Enter to run, Esc to clear)";
      input.spellcheck = false;
      input.autocapitalize = "off";
      input.setAttribute("autocorrect", "off");
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.runQuery(input.value); }
        else if (e.key === "Escape") { e.preventDefault(); input.value = ""; this.resetQuery(); }
      });

      const runBtn = button("Run", () => this.runQuery(input.value));
      const clearBtn = this.clearBtn = button("Clear", () => { input.value = ""; this.resetQuery(); });
      clearBtn.style.display = "none";

      const drawer = this.buildExamplesDrawer();
      const helpBtn = button("Examples", () => {
        const open = drawer.classList.toggle("jv-open");
        helpBtn.textContent = open ? "Hide examples" : "Examples";
      });

      const status = this.queryStatus = document.createElement("span");
      status.className = "jv-query-status";
      status.style.display = "none";

      const bar = document.createElement("div");
      bar.className = "jv-query-bar";
      bar.append(text("jq", "jv-query-label"), input, runBtn, clearBtn, helpBtn, status);

      wrap.append(bar, drawer);
      return wrap;
    }

    private buildExamplesDrawer(): HTMLElement {
      // Every one of these is verified to run on the pinned jqjs.
      const examples: [string, string][] = [
        [".", "the whole document (reset)"],
        ["keys", "top-level keys"],
        [".links", "value at a key"],
        [".links[] | .href", "one field from every array item"],
        ['.links[] | select(.rel == "child")', "array items matching a field"],
        [".links | length", "count items"],
        ['.. | select(type == "string")', "every string anywhere (deep search)"],
        ["[paths]", "every path in the document (locate keys)"],
        ["to_entries | map(.key)", "an object's keys, as data"],
      ];
      const drawer = document.createElement("div");
      drawer.className = "jv-query-drawer";
      for (const [prog, desc] of examples) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "jv-example";
        row.append(text(prog, "jv-example-code"), text(desc, "jv-example-desc"));
        row.addEventListener("click", () => {
          this.queryInput.value = prog;
          this.queryInput.focus();
          this.runQuery(prog);
        });
        drawer.appendChild(row);
      }
      drawer.appendChild(text("core jq via jqjs — not every builtin is implemented", "jv-examples-note"));
      return drawer;
    }

    private runQuery(rawProgram: string): void {
      const program = rawProgram.trim();
      if (!program || program === ".") { this.resetQuery(); return; }

      let compiled: (input: unknown) => Iterable<unknown>;
      try {
        compiled = jqjs.compile(program);
      } catch (err) {
        this.setQueryStatus(`error: ${(err as Error).message}`, true);
        return;
      }

      const runId = ++this.queryRunId;
      this.setQueryStatus("running…", false);
      // Drain the generator in ~16ms slices so the tab stays responsive and a
      // newer query (or Clear) can cancel this one.
      void nextPaint().then(async () => {
        const outputs: Json[] = [];
        let truncated = false;
        try {
          const it = compiled(this.original)[Symbol.iterator]();
          let slice = performance.now();
          for (;;) {
            if (runId !== this.queryRunId) return; // superseded / cancelled
            const next = it.next();
            if (next.done) break;
            outputs.push(next.value as Json);
            if (outputs.length >= QUERY_CAP) { truncated = true; break; }
            if (performance.now() - slice > 16) {
              this.setQueryStatus(`running… ${outputs.length.toLocaleString()}`, false);
              await macrotask();
              slice = performance.now();
            }
          }
        } catch (err) {
          if (runId === this.queryRunId) this.setQueryStatus(`error: ${(err as Error).message}`, true);
          return;
        }
        if (runId !== this.queryRunId) return;
        this.showData(outputs.length === 1 ? outputs[0] : outputs, true);
        const n = outputs.length;
        this.setQueryStatus(`${n}${truncated ? "+" : ""} result${n === 1 ? "" : "s"}`, false);
      });
    }

    private resetQuery(): void {
      this.queryRunId++;
      this.setQueryStatus("", false);
      this.showData(this.original, false);
    }

    // Swap the viewed value (original document or a query result) and re-fit it
    // to the same tree — fresh expansion state, buttons, and scroll position.
    private showData(data: Json, isResult: boolean): void {
      this.data = data;
      this.viewingResult = isResult;
      this.model.setData(data);
      this.syncSizerHeight();
      this.updateButtons();
      // A query result can be a wholly different (and shorter) row set.
      this.focusIndex = Math.min(this.focusIndex, this.rows.length - 1);
      this.find.refresh();
      this.clearBtn.style.display = isResult ? "" : "none";
      if (this.rawPre) this.rawPre.textContent = this.currentText();
      this.scroller.scrollTop = 0;
      this.scheduleRender();
    }

    // The text behind "Copy" and "View raw": the exact original payload while
    // the whole document is shown, or the pretty-printed value once a jq query
    // has replaced the view — i.e. always what's currently on screen.
    private currentText(): string {
      return this.viewingResult ? JSON.stringify(this.data, null, 2) : this.raw;
    }

    private setQueryStatus(msg: string, isError: boolean): void {
      this.queryStatus.textContent = msg;
      this.queryStatus.classList.toggle("jv-query-err", isError && msg !== "");
      this.queryStatus.style.display = msg ? "" : "none";
    }

    // ---- Scroll helper -----------------------------------------------------
    // Shared by find (its scroll-to-match) and keyboard focus (moveFocus): scrolls
    // the minimum amount needed to bring row `idx` fully into view, without
    // jumping when it's already visible.
    private scrollIndexIntoView(idx: number): void {
      const top = idx * ROW_H;
      const viewTop = this.scroller.scrollTop;
      const viewH = this.scroller.clientHeight;
      if (top < viewTop) this.scroller.scrollTop = top;
      else if (top + ROW_H > viewTop + viewH) this.scroller.scrollTop = top + ROW_H - viewH;
    }

    // ---- Keyboard focus -----------------------------------------------------
    private moveFocus(dir: number): void {
      let i = this.focusIndex + dir;
      while (i >= 0 && i < this.rows.length && this.rows[i].closing) i += dir; // skip closing rows
      if (i < 0 || i >= this.rows.length) return;
      this.focusIndex = i;
      this.scrollIndexIntoView(i);
      this.scheduleRender();
    }

    private focusExpand(): void {
      const row = this.rows[this.focusIndex];
      if (row?.expandable && !this.model.expanded.has(row.path)) this.toggle(this.focusIndex);
      else this.moveFocus(1); // already open (or a leaf): descend
    }

    private focusCollapse(): void {
      const row = this.rows[this.focusIndex];
      if (row?.expandable && this.model.expanded.has(row.path)) {
        this.toggle(this.focusIndex);
        return;
      }
      // else jump to parent (nearest shallower non-closing row above)
      const j = this.model.parentIndexOf(this.focusIndex);
      if (j !== -1) {
        this.focusIndex = j;
        this.scrollIndexIntoView(j);
        this.scheduleRender();
      }
    }

    // ---- Row model (thin wrappers over TreeModel + DOM sync) ---------------
    // Expand/collapse the container at `index`. The DOM-free model does the row
    // splicing; JsonView owns the sizer height, buttons, find re-run, focus
    // clamp, repaint, and — on a cap refusal — the alert.
    private toggle(index: number): void {
      const row = this.rows[index];
      if (!row || !row.expandable) return;

      const result = this.model.toggle(index);
      if (!result.ok) {
        // EXPAND_CAP refusal: same message text as before the extraction.
        alert(`Expanding this would add ${result.wouldAdd.toLocaleString()} rows and may stall the tab. Use the jq bar to filter it instead.`);
        return;
      }
      this.syncSizerHeight();
      this.updateButtons();
      this.find.refresh();
      // A collapse can shrink this.rows past the current focus index.
      if (this.focusIndex >= this.rows.length) this.focusIndex = this.rows.length - 1;
      this.scheduleRender();
    }

    // Open the outer edge one layer deeper: every collapsed container that is
    // currently visible becomes expanded. Repeated presses unfold the tree.
    private expandLevel(): void {
      const result = this.model.expandLevel();
      if (!result.ok) {
        // EXPAND_CAP refusal: same message text as before the extraction.
        alert(`That would show ${(this.rows.length + result.wouldAdd).toLocaleString()} rows. Expand nodes individually instead.`);
        return;
      }
      this.syncSizerHeight();
      this.updateButtons();
      this.find.refresh();
      this.scheduleRender();
    }

    // Close the innermost open layer: every expanded container with no expanded
    // container beneath it (the root included, so it can fold to one line).
    private collapseLevel(): void {
      this.model.collapseLevel();
      this.syncSizerHeight();
      this.updateButtons();
      this.find.refresh();
      this.scheduleRender();
    }

    private toggleRaw(btn: HTMLButtonElement): void {
      this.showingRaw = !this.showingRaw;
      btn.textContent = this.showingRaw ? "View tree" : "View raw";
      if (this.showingRaw) {
        this.scroller.style.display = "none";
        if (!this.rawPre) {
          this.rawPre = document.createElement("pre");
          this.rawPre.className = "jv-raw";
          this.scroller.parentElement!.appendChild(this.rawPre);
        }
        this.rawPre.textContent = this.currentText();
        this.rawPre.style.display = "";
      } else {
        this.scroller.style.display = "";
        if (this.rawPre) this.rawPre.style.display = "none";
      }
    }

    // ---- Rendering (virtualized) ------------------------------------------
    private scheduleRender(): void {
      if (this.renderScheduled) return;
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.renderWindow();
      });
    }

    private renderWindow(): void {
      const scrollTop = this.scroller.scrollTop;
      const height = this.scroller.clientHeight || window.innerHeight;
      const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
      const count = Math.ceil(height / ROW_H) + OVERSCAN * 2;
      const last = Math.min(this.rows.length, first + count);

      this.canvas.style.transform = `translateY(${first * ROW_H}px)`;
      const frag = document.createDocumentFragment();
      for (let i = first; i < last; i++) frag.appendChild(this.renderRow(this.rows[i], i));
      this.canvas.replaceChildren(frag);
    }

    private renderRow(row: Row, index: number): HTMLElement {
      const el = document.createElement("div");
      el.className = "jv-row";
      el.dataset.index = String(index);
      el.style.paddingLeft = `${row.depth * INDENT}px`;

      // Find highlight: a matching row gets a "hit" tint; the current match a
      // stronger one. The find controller owns the match set and answers both
      // in O(1) (indices always refer to the freshly rebuilt row set — find
      // re-runs on every row-set change).
      if (this.find.isHit(index)) {
        el.classList.add("jv-find-hit");
        if (this.find.isCurrent(index)) el.classList.add("jv-find-current");
      }

      // Closing bracket row: an empty caret keeps it aligned under its key.
      // No ARIA role — it's a synthetic punctuation row, not a tree node.
      if (row.closing) {
        const gap = document.createElement("span");
        gap.className = "jv-caret jv-caret-empty";
        el.append(gap, text(row.kind === "array" ? "]" : "}", "jv-punct"));
        return el;
      }

      // ARIA: every real node is a treeitem at its 1-based nesting level;
      // expandable nodes report their open/closed state. Focus is virtual
      // (index-tracked, not real DOM focus — real focus fights the row
      // recycling that virtualization relies on), so the focused row is
      // marked with a class instead of :focus.
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-level", String(row.depth + 1));
      if (row.expandable) el.setAttribute("aria-expanded", String(this.model.expanded.has(row.path)));
      if (this.navActive && index === this.focusIndex) el.classList.add("jv-focus");

      // caret
      const caret = document.createElement("span");
      caret.className = "jv-caret";
      if (row.expandable) {
        caret.textContent = this.model.expanded.has(row.path) ? "▾" : "▸";
      } else {
        caret.classList.add("jv-caret-empty");
      }
      el.appendChild(caret);

      // key
      if (row.label !== null) {
        const key = document.createElement("span");
        key.className = "jv-key";
        key.textContent = row.label;
        el.appendChild(key);
        el.appendChild(text(": ", "jv-punct"));
      }

      // value
      el.appendChild(this.renderValue(row));

      // Per-row copy-path: copies the jq expression that selects this node.
      const copyPath = document.createElement("span");
      copyPath.className = "jv-copypath";
      copyPath.title = "Copy jq path to this value";
      copyPath.textContent = "⌖";
      el.appendChild(copyPath);

      // Per-row copy: grabs this node's whole subtree as pretty JSON,
      // regardless of scroll position or what is currently collapsed.
      const copy = document.createElement("span");
      copy.className = "jv-copy";
      copy.title = "Copy this value as JSON";
      copy.textContent = "⧉";
      el.appendChild(copy);
      return el;
    }

    private renderValue(row: Row): HTMLElement {
      const wrap = document.createElement("span");
      switch (row.kind) {
        case "object":
        case "array": {
          const open = row.kind === "array" ? "[" : "{";
          const close = row.kind === "array" ? "]" : "}";
          if (row.childCount === 0) {
            wrap.appendChild(text(open + close, "jv-punct"));
          } else if (this.model.expanded.has(row.path)) {
            wrap.appendChild(text(open, "jv-punct"));
          } else {
            wrap.appendChild(text(open, "jv-punct"));
            const noun = row.kind === "array" ? "items" : "keys";
            wrap.appendChild(text(` ${row.childCount} ${noun} `, "jv-summary"));
            wrap.appendChild(text(close, "jv-punct"));
          }
          break;
        }
        case "string":
          wrap.appendChild(this.renderString(row.value as string));
          break;
        case "number":
          wrap.appendChild(text(String(row.value), "jv-num"));
          break;
        case "boolean":
          wrap.appendChild(text(String(row.value), "jv-bool"));
          break;
        case "null":
          wrap.appendChild(text("null", "jv-null"));
          break;
      }
      return wrap;
    }

    private renderString(s: string): HTMLElement {
      const span = document.createElement("span");
      span.className = "jv-str";

      // Whole-value URL → safe anchor (scheme is guaranteed http/https).
      if (URL_RE.test(s)) {
        span.appendChild(text('"', "jv-punct"));
        const a = document.createElement("a");
        a.href = s;
        a.textContent = s;
        // Same-tab navigation. Cmd/Ctrl-click still opens a new tab natively.
        a.rel = "noopener noreferrer";
        a.className = "jv-link";
        span.appendChild(a);
        span.appendChild(text('"', "jv-punct"));
        return span;
      }

      if (s.length <= STR_MAX) {
        span.textContent = JSON.stringify(s);
        return span;
      }

      // Long string: truncated head + full body (CSS-hidden) + toggle.
      const shown = document.createElement("span");
      shown.className = "jv-str-shown";
      shown.textContent = JSON.stringify(s.slice(0, STR_MAX)).slice(0, -1) + "…";
      const full = document.createElement("span");
      full.className = "jv-str-hidden";
      full.textContent = JSON.stringify(s);
      const more = document.createElement("span");
      more.className = "jv-str-more";
      more.textContent = "…show";
      span.append(shown, full, more);
      return span;
    }
  }

  // ---- Bootstrapping -------------------------------------------------------
  async function getRawText(): Promise<string> {
    const pre = document.body?.querySelector("pre");
    if (pre?.textContent) return pre.textContent;
    if (document.body?.textContent && document.body.childElementCount <= 1) {
      return document.body.textContent;
    }
    const res = await fetch(location.href, { credentials: "include" });
    return res.text();
  }

  async function activate(): Promise<void> {
    // `forced` = this run was let through by the lone-JSON-body fallback, not
    // a genuine JSON content-type. Reuses the already-computed `looksLikeJson`
    // rather than re-deriving it from `document.contentType` a second time.
    const forced = !looksLikeJson;

    if (forced) {
      // CRITICAL: re-check the predicate now that the body is populated
      // (document_start saw an empty body and conservatively returned true).
      // getRawText()'s fallback is a fetch() of the page's own URL when the
      // body has more than one child element — exactly what a real HTML page
      // looks like by DOMContentLoaded. Without this re-check, EVERY ordinary
      // HTML page would sail through the document_start gate and then
      // re-fetch itself here before bailing, which is wasteful and wrong.
      // Bail silently, before ever calling getRawText/fetch, the moment the
      // populated body no longer looks like a lone JSON/NDJSON payload.
      if (!looksLikeLoneJsonBody()) {
        document.documentElement.classList.remove("jv-active");
        return;
      }
    }

    const raw = await getRawText();

    // Paint a loading state before the blocking parse.
    const loading = document.createElement("div");
    loading.className = "jv-loading";
    loading.textContent = "Parsing…";
    (document.body || document.documentElement).replaceChildren(loading);
    await nextPaint();

    let data: Json;
    let note = "";
    try {
      data = JSON.parse(raw) as Json;
    } catch (err) {
      const nd = tryParseNdjson(raw);
      if (nd) {
        data = nd;
        note = "NDJSON";
      } else if (forced) {
        // A forced attempt on an ordinary non-JSON text page: don't hijack it
        // with an error screen, just quietly stand down.
        document.documentElement.classList.remove("jv-active");
        return;
      } else {
        renderParseError(raw, err);
        return;
      }
    }
    new JsonView(data, raw, note).mount();
  }

  function renderParseError(raw: string, err: unknown): void {
    const box = document.createElement("div");
    box.className = "jv-app";
    const head = document.createElement("div");
    head.className = "jv-toolbar";
    head.textContent = `Not valid JSON — ${(err as Error).message}`;
    const pre = document.createElement("pre");
    pre.className = "jv-raw";
    pre.textContent = raw;
    box.append(head, pre);
    (document.body || document.documentElement).replaceChildren(box);
  }

  function fatal(err: unknown): void {
    // Never leave the page blank: fall back to the raw payload.
    document.documentElement.classList.remove("jv-active");
    console.error("[json-viewer]", err);
  }
})();
