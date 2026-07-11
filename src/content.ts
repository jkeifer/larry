/*
 * Trustworthy JSON Viewer — content script.
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

(() => {
  "use strict";

  // ---- Activation gate -----------------------------------------------------
  const contentType = (document.contentType || "").toLowerCase();
  const looksLikeJson = contentType === "application/json" || contentType.endsWith("+json");
  if (!looksLikeJson) return;

  // Add the marker synchronously (we are at document_start) so content.css can
  // hide the browser's raw text node before it paints — no flash.
  document.documentElement.classList.add("jv-active");

  const run = () => activate().catch(fatal);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  // ---- Types ---------------------------------------------------------------
  type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
  type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";

  interface Row {
    path: string;          // stable id, e.g. $["a"][0]
    label: string | null;  // object key or array index, null for the root row
    value: Json;
    depth: number;
    kind: Kind;
    expandable: boolean;
    childCount: number;
    closing?: boolean;     // synthetic "]" / "}" row that closes an expanded container
  }

  const ROW_H = 20;        // px, fixed so virtualization needs no measurement
  const INDENT = 16;       // px per depth level
  const OVERSCAN = 12;     // rows rendered above/below the viewport
  const ROW_BUDGET = 100000; // fully expand on load unless it would exceed this many rows
  const STR_MAX = 200;     // chars shown before a long string is truncated
  const URL_RE = /^https?:\/\/[^\s]+$/i;

  // ---- Helpers -------------------------------------------------------------
  function kindOf(v: Json): Kind {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (t === "object") return "object";
    return t as Kind; // "string" | "number" | "boolean"
  }

  function isContainer(k: Kind): boolean {
    return k === "object" || k === "array";
  }

  function childCountOf(v: Json, k: Kind): number {
    if (k === "array") return (v as Json[]).length;
    if (k === "object") return Object.keys(v as object).length;
    return 0;
  }

  function* entriesOf(v: Json, k: Kind): Generator<[string, Json]> {
    if (k === "array") {
      const a = v as Json[];
      for (let i = 0; i < a.length; i++) yield [String(i), a[i]];
    } else if (k === "object") {
      const o = v as { [k: string]: Json };
      for (const key of Object.keys(o)) yield [key, o[key]];
    }
  }

  function childPath(parent: string, label: string, parentKind: Kind): string {
    return parentKind === "array" ? `${parent}[${label}]` : `${parent}[${JSON.stringify(label)}]`;
  }

  // Splice `items` into `arr` at `index` without hitting the argument-count
  // limit that `arr.splice(i, 0, ...huge)` triggers for very large arrays.
  function spliceInto<T>(arr: T[], index: number, items: T[]): void {
    const CHUNK = 30000;
    if (items.length <= CHUNK) {
      arr.splice(index, 0, ...items);
      return;
    }
    const tail = arr.splice(index); // detach everything from index onward
    for (let i = 0; i < items.length; i += CHUNK) {
      arr.push.apply(arr, items.slice(i, i + CHUNK));
    }
    for (let i = 0; i < tail.length; i += CHUNK) {
      arr.push.apply(arr, tail.slice(i, i + CHUNK));
    }
  }

  const nextPaint = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

  // ---- The viewer ----------------------------------------------------------
  class JsonView {
    private data: Json;
    private raw: string;
    private expanded = new Set<string>();
    private rows: Row[] = [];

    private scroller!: HTMLDivElement;   // the scroll viewport
    private sizer!: HTMLDivElement;      // full-height spacer
    private canvas!: HTMLDivElement;     // holds the visible slice
    private rawPre: HTMLPreElement | null = null;
    private showingRaw = false;
    private renderScheduled = false;
    private collapseBtn!: HTMLButtonElement;
    private expandBtn!: HTMLButtonElement;

    constructor(data: Json, raw: string) {
      this.data = data;
      this.raw = raw;
    }

    mount(): void {
      document.title = document.title || "JSON";
      const app = document.createElement("div");
      app.className = "jv-app";
      app.append(this.buildToolbar(), this.buildTree());

      // Replace the page body wholesale with our UI.
      const body = document.body || document.documentElement.appendChild(document.createElement("body"));
      body.textContent = "";
      body.appendChild(app);

      this.autoExpand();
      this.rebuildRows();
      this.updateButtons();
      this.scheduleRender();
    }

    // Disable a stepper when it has nothing left to do: Expand when every
    // container is open, Collapse when none is. Recomputed only on expansion
    // changes (never on scroll), so the short-circuiting scans stay cheap.
    private updateButtons(): void {
      let canExpand = false;
      let canCollapse = false;
      for (const r of this.rows) {
        if (!r.expandable) continue;
        if (this.expanded.has(r.path)) canCollapse = true;
        else canExpand = true;
        if (canExpand && canCollapse) break;
      }
      this.expandBtn.disabled = !canExpand;
      this.collapseBtn.disabled = !canCollapse;
    }

    // ---- Chrome ------------------------------------------------------------
    private buildToolbar(): HTMLElement {
      const bar = document.createElement("div");
      bar.className = "jv-toolbar";

      const size = new Blob([this.raw]).size;
      const info = document.createElement("span");
      info.className = "jv-info";
      info.textContent = `${kindOf(this.data)} · ${formatBytes(size)}`;

      const collapseBtn = this.collapseBtn = button("Collapse level", () => this.collapseLevel());
      const expandBtn = this.expandBtn = button("Expand level", () => this.expandLevel());
      const rawBtn = button("View raw", () => this.toggleRaw(rawBtn));
      const copyBtn = button("Copy", async () => {
        try {
          await navigator.clipboard.writeText(this.raw);
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
          this.copyNode(index, copyEl);
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
      this.scroller.addEventListener("copy", (e) => this.onCopy(e as ClipboardEvent));

      return this.scroller;
    }

    // ---- Row model ---------------------------------------------------------
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
        path: row.path + " )",
        label: null,
        value: null,
        depth: row.depth,
        kind: row.kind,
        expandable: false,
        childCount: 0,
        closing: true,
      };
    }

    // Depth-first materialization honoring the current `expanded` set.
    private materialize(row: Row, out: Row[]): void {
      out.push(row);
      if (!row.expandable || !this.expanded.has(row.path)) return;
      for (const [label, child] of entriesOf(row.value, row.kind)) {
        this.materialize(this.makeRow(childPath(row.path, label, row.kind), label, child, row.depth + 1), out);
      }
      out.push(this.closeRow(row));
    }

    private rebuildRows(): void {
      const out: Row[] = [];
      this.materialize(this.makeRow("$", null, this.data, 0), out);
      this.rows = out;
      if (this.sizer) this.sizer.style.height = `${this.rows.length * ROW_H}px`;
    }

    private toggle(index: number): void {
      const row = this.rows[index];
      if (!row || !row.expandable) return;

      if (this.expanded.has(row.path)) {
        // Collapse: drop the descendant block plus this container's close row.
        this.expanded.delete(row.path);
        let end = index + 1;
        while (end < this.rows.length && this.rows[end].depth > row.depth) end++;
        if (end < this.rows.length && this.rows[end].closing && this.rows[end].depth === row.depth) end++;
        this.rows.splice(index + 1, end - (index + 1));
      } else {
        // Expand: materialize children (honoring any nested expanded state),
        // then this container's own closing bracket.
        this.expanded.add(row.path);
        const sub: Row[] = [];
        for (const [label, child] of entriesOf(row.value, row.kind)) {
          this.materialize(this.makeRow(childPath(row.path, label, row.kind), label, child, row.depth + 1), sub);
        }
        sub.push(this.closeRow(row));
        spliceInto(this.rows, index + 1, sub);
      }
      this.sizer.style.height = `${this.rows.length * ROW_H}px`;
      this.updateButtons();
      this.scheduleRender();
    }

    private autoExpand(): void {
      // Fully expand by default. Virtualization bounds the DOM, but neither the
      // row model nor the sizer height is bounded, so we only fall back to
      // collapsing when a full expansion would materialize more than ROW_BUDGET
      // rows. In that case we keep the shallowest levels — which show the
      // document's overall shape — and leave the deepest levels collapsed.
      this.markToDepth(this.data, "$", 0, this.fitDepth(ROW_BUDGET));
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
    private expandLevel(): void {
      const frontier = this.rows.filter((r) => r.expandable && !this.expanded.has(r.path));
      if (frontier.length === 0) return; // already fully expanded
      const added = frontier.reduce((sum, r) => sum + r.childCount, 0);
      if (this.rows.length + added > 200000) {
        alert(`That would show ${(this.rows.length + added).toLocaleString()} rows. Expand nodes individually instead.`);
        return;
      }
      for (const r of frontier) this.expanded.add(r.path);
      this.rebuildRows();
      this.updateButtons();
      this.scheduleRender();
    }

    // Close the innermost open layer: every expanded container with no expanded
    // container beneath it (the root included, so it can fold to one line). One
    // DFS pass, tracking per-container whether it holds an expanded descendant.
    private collapseLevel(): void {
      const innermost: Row[] = [];
      const stack: { row: Row; hasExpandedChild: boolean }[] = [];
      const drain = (untilDepth: number): void => {
        while (stack.length && untilDepth <= stack[stack.length - 1].row.depth) {
          const top = stack.pop()!;
          if (!top.hasExpandedChild) innermost.push(top.row);
        }
      };
      for (const r of this.rows) {
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
      this.updateButtons();
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
          this.rawPre.textContent = this.raw;
          this.scroller.parentElement!.appendChild(this.rawPre);
        }
        this.rawPre.style.display = "";
      } else {
        this.scroller.style.display = "";
        if (this.rawPre) this.rawPre.style.display = "none";
      }
    }

    // ---- Copy --------------------------------------------------------------
    // Per-row: copy this node's entire subtree, however large, as pretty JSON.
    private async copyNode(index: number, el: HTMLElement): Promise<void> {
      const row = this.rows[index];
      if (!row) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(row.value, null, 2));
        el.classList.add("jv-copied");
        setTimeout(() => el.classList.remove("jv-copied"), 900);
      } catch {
        /* clipboard blocked by the page context; nothing safe to do */
      }
    }

    private onCopy(e: ClipboardEvent): void {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      // A selection sitting entirely inside one text node is a substring copy
      // (e.g. part of a string value) — leave that to the browser untouched.
      if (sel.anchorNode === sel.focusNode && sel.anchorNode?.nodeType === Node.TEXT_NODE) {
        return;
      }

      // Which rendered rows does the selection touch? (Off-screen rows do not
      // exist in the DOM — for those, use the per-row copy affordance.)
      const indices: number[] = [];
      this.canvas.querySelectorAll<HTMLElement>(".jv-row").forEach((el) => {
        if (sel.containsNode(el, true)) {
          const i = Number(el.dataset.index);
          if (!Number.isNaN(i) && !this.rows[i]?.closing) indices.push(i);
        }
      });
      if (indices.length === 0) return;

      indices.sort((a, b) => a - b);
      e.clipboardData?.setData("text/plain", this.selectionToJson(indices));
      e.preventDefault();
    }

    // Pretty-printed JSON for a set of selected row indices. Only the top-level
    // nodes of the selection matter — a node with a selected ancestor is already
    // contained in that ancestor's output. A single resolved node copies as
    // clean valid JSON; several siblings copy as an object/array fragment.
    private selectionToJson(indices: number[]): string {
      const selected = new Set(indices);
      const parentOf = (i: number): number => {
        const d = this.rows[i].depth;
        for (let j = i - 1; j >= 0; j--) {
          if (this.rows[j].closing) continue;
          if (this.rows[j].depth < d) return j;
        }
        return -1;
      };
      const hasSelectedAncestor = (i: number): boolean => {
        for (let p = parentOf(i); p !== -1; p = parentOf(p)) if (selected.has(p)) return true;
        return false;
      };
      const roots = indices.filter((i) => !hasSelectedAncestor(i));
      if (roots.length === 1) return JSON.stringify(this.rows[roots[0]].value, null, 2);
      return roots
        .map((i) => {
          const row = this.rows[i];
          const value = JSON.stringify(row.value, null, 2);
          const parent = parentOf(i);
          const parentKind = parent === -1 ? null : this.rows[parent].kind;
          return row.label !== null && parentKind === "object"
            ? `${JSON.stringify(row.label)}: ${value}`
            : value;
        })
        .join(",\n");
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

      // Closing bracket row: an empty caret keeps it aligned under its key.
      if (row.closing) {
        const gap = document.createElement("span");
        gap.className = "jv-caret jv-caret-empty";
        el.append(gap, text(row.kind === "array" ? "]" : "}", "jv-punct"));
        return el;
      }

      // caret
      const caret = document.createElement("span");
      caret.className = "jv-caret";
      if (row.expandable) {
        caret.textContent = this.expanded.has(row.path) ? "▾" : "▸";
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
          } else if (this.expanded.has(row.path)) {
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

  // ---- Small DOM utilities -------------------------------------------------
  function text(t: string, cls: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = t;
    return s;
  }
  function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "jv-btn";
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function spacer(): HTMLElement {
    const s = document.createElement("span");
    s.className = "jv-spacer";
    return s;
  }
  function flash(btn: HTMLButtonElement, msg: string): void {
    const prev = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => (btn.textContent = prev), 1200);
  }
  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
    const raw = await getRawText();

    // Paint a loading state before the blocking parse.
    const loading = document.createElement("div");
    loading.className = "jv-loading";
    loading.textContent = "Parsing…";
    (document.body || document.documentElement).replaceChildren(loading);
    await nextPaint();

    let data: Json;
    try {
      data = JSON.parse(raw) as Json;
    } catch (err) {
      renderParseError(raw, err);
      return;
    }
    new JsonView(data, raw).mount();
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
