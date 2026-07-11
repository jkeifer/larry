# larry — Hardening, Config & Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring larry (a zero-permission MV3 JSON-viewer extension) to a publishable, hardened state: project config (license, gitignore, git-derived version, icons, pre-commit, CI), two robustness fixes, and five features (NDJSON, in-tree find, copy-path, keyboard nav, forced activation).

**Architecture:** larry is a single content script `src/content.ts` (compiled to `content.js`) + `src/content.css` + `src/manifest.json`, built by a Nix flake that also vendors `jqjs` (a pinned, eval-free pure-JS jq engine) and shims it to a global `jqjs.js`. All viewer logic lives in one `JsonView` class inside an IIFE. There is intentionally no runtime dependency beyond jqjs and no `chrome.*` API usage. Preserve all of that.

**Tech Stack:** TypeScript (strict), **esbuild** (bundles `src/content.ts` + `src/core.ts` → one IIFE `content.js`), `tsc --noEmit` (type-checking only), Nix flakes, MV3 content scripts, jqjs. Tests: **vitest** (unit, against `src/core.ts`) + **Playwright** (E2E, loads the built extension).

**Design note (why this shape):** Pure, DOM-free logic is extracted into `src/core.ts` (exported functions) so it's unit-testable; `src/content.ts` imports it and does the DOM/wiring. esbuild bundles them into the single classic `content.js` the manifest loads. The old README "principles" (single file, zero deps, no `chrome.*`) are **not** binding — they were an artifact, not a requirement. We keep *no network*, *no `eval` in shipped code*, and *minimal permissions* on their own merit; everything else is negotiable.

## Global Constraints

Copy these verbatim into your working memory; every task must honor them.

- **No `chrome.*` APIs** anywhere in `content.ts`. This is a core auditability claim in the README. If a feature seems to need one, stop and flag it.
- **No runtime dependency other than jqjs.** No npm packages ship in the extension. No network calls.
- **No `eval` / `new Function`.**
- **TypeScript is strict** with `noUnusedLocals` + `noUnusedParameters`. Unused symbols fail the build. Every `tsc` run must pass clean.
- **The only build command is `nix build`** (runs `tsc -p tsconfig.json`, copies assets, shims jqjs). It emits `result/extension/` (loadable) and `result/json-viewer.zip`. A "dirty git tree" warning is expected and harmless.
- **Manifest `version` must be 1–4 dot-separated integers** (0–65535 each). No hashes, no `+`, no suffixes. Chrome rejects anything else.
- **Row model invariant:** `this.rows` is a flat DFS-ordered array of `Row`. Containers that are expanded emit their children then a synthetic **closing row** (`row.closing === true`, same `depth`, `value: null`). Closing rows are never expandable, never copied, never counted as query nodes. Any code that walks `this.rows` must skip `closing` rows where node identity matters.
- **`ROW_BUDGET = 100000`** (auto-expand cap), **`QUERY_CAP = 200000`** (jq output cap). Reuse these; don't invent new magic numbers without cause.
- **Every feature must keep working in both activation modes:** auto-run on JSON pages (`document_start`) and click-injected post-load (the `action` icon under Chrome's "When you click the extension").

## How to verify

A real harness is set up in Task 4. Use these, in order, as each task's tests:

1. `nix develop -c tsc --noEmit -p tsconfig.json` — type check. Must be clean.
2. `nix develop -c vitest run` — **unit tests** against `src/core.ts`. Must pass. (Feature tasks that add pure logic add cases here first — TDD.)
3. `nix build` — full esbuild bundle + package. Must exit 0.
4. `nix develop -c npx playwright test` — **E2E** against `result/extension/`. Must pass. (Feature tasks with UI behavior add a spec here.)
5. **Manual browser sanity** — reload `result/extension/` at `chrome://extensions`, open the named fixture, eyeball the task's steps. Faster than writing E2E for purely visual polish; still required where noted.

Until Task 4 lands, Tasks 1–3 use only steps 1 and 3 (typecheck + build). From Task 4 onward, prefer unit/E2E over manual checks.

**Commit after each task** (the user handles branching/pushing). Message convention: `feat:`, `fix:`, `chore:`, `docs:`.

**Test fixtures** (use these throughout): the Earth Search STAC catalog `https://earth-search.aws.element84.com/v1` (medium object with `links`/`conformsTo` arrays); any large JSON API response for perf checks; a hand-made `test/fixtures/sample.ndjson` (added in Task 7).

---

## File map

- `LICENSE` — **create**. MIT text.
- `.gitignore` — **modify**. Add build/tooling artifacts.
- `flake.nix` — **modify**. Git-derived version injection; SVG→PNG icon rasterization; add `prek` + `rsvg`/`resvg` + `nodejs` to devShell.
- `src/manifest.json` — **modify**. `version` becomes a build-injected placeholder; add `icons` + `action.default_icon`.
- `src/icon.svg` — **create**. Vector monogram `{ L }`.
- `.pre-commit-config.yaml` — **create**. `language: system` hooks only.
- `.github/workflows/ci.yml` — **create**. Nix build + typecheck + prek + smoke test.
- `test/smoke.mjs` — **create**. jqjs shim regression test.
- `test/fixtures/sample.ndjson` — **create**.
- `src/content.ts` — **modify** (most feature work). New: NDJSON detection, `toggle()` guard, time-sliced query runner, find UI + model search, copy-path affordance, keyboard navigation + ARIA, forced-activation fallback.
- `src/content.css` — **modify**. Styles for find bar, match highlight, copy-path, focus ring.
- `README.md` — **modify**. Document version scheme, icons, find, NDJSON, forced activation, dev/CI, privacy.
- `docs/PRIVACY.md` — **create**. Privacy disclosure.
- `docs/store-listing.md` — **create**. Draft Web Store copy.

---

## Task 1: License + gitignore

**Files:**
- Create: `LICENSE`
- Modify: `.gitignore`

- [ ] **Step 1: Create `LICENSE`** — standard MIT text, exactly:

```
MIT License

Copyright (c) 2026 Jarrett Keifer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Replace `.gitignore`** with the full set of artifacts:

```
# Nix
result
result-*

# direnv
.direnv/

# non-Nix build output
dist/

# node (non-Nix dev path)
node_modules/
```

- [ ] **Step 3: Note jqjs attribution.** jqjs is MIT and its license header ships inside the built `jqjs.js` (the build only strips `export` lines, not the header comment). No separate NOTICE file is required, but add one line to `README.md`'s License section: "Bundles jqjs (MIT, © Michael Homer) at build time; its license header is preserved in the shipped `jqjs.js`." Make that edit now.

- [ ] **Step 4: Verify** `git status` shows `result`/`.direnv` no longer listed as untracked. Run `git check-ignore result .direnv/x dist/x node_modules/x` — all four must echo back.

- [ ] **Step 5: Commit**

```bash
git add LICENSE .gitignore README.md
git commit -m "chore: add MIT LICENSE and complete .gitignore"
```

---

## Task 2: Git-derived manifest version

**Files:**
- Modify: `flake.nix` (package derivation), `src/manifest.json`

**Interfaces:**
- Produces: the built `manifest.json` carries `version` = `1.0.<revCount>` on clean git trees, `1.0.0` on dirty/dev trees.

**Design (approach A — git describe via impure env):** The version comes from `git describe --tags --long` computed *outside* the Nix sandbox (the sandbox has no `.git`), mapped to Chrome's integer-only format `MAJOR.MINOR.PATCH.DISTANCE`, and passed in through `LARRY_VERSION` via `--impure` + `builtins.getEnv`. Never committed. Dev/CI builds without the env var fall back to the pure `1.0.${self.revCount or 0}`. `src/manifest.json` keeps a literal `"0.0.0"` placeholder so the non-Nix path still loads; the flake overwrites it at build.

- [ ] **Step 1: In `flake.nix`**, compute the version in the `let` of the package derivation (or inline in `mkDerivation`). Replace the hardcoded `version = "1.0.0";` with:

```nix
          version =
            let env = builtins.getEnv "LARRY_VERSION";
            in if env != "" then env else "1.0.${toString (self.revCount or 0)}";
```

> `builtins.getEnv` returns `""` unless the build is `--impure`. On a normal `nix build` you get the `revCount` fallback; on a release you run the command in Step 5.

- [ ] **Step 2: In `buildPhase`**, after `cp src/content.css src/manifest.json dist/`, overwrite the placeholder. `${version}` here is Nix interpolation of the attribute above:

```bash
            substituteInPlace dist/manifest.json \
              --replace-quiet '"version": "0.0.0"' '"version": "${version}"'
```

- [ ] **Step 3: Set `src/manifest.json` `version`** to `"0.0.0"`.

- [ ] **Step 4: Verify the fallback.** `nix build` (no env) → `grep version result/extension/manifest.json` shows `"1.0.0"` (dirty tree → revCount 0) or `1.0.<n>` on a clean commit.

- [ ] **Step 5: Verify approach A end-to-end.** Tag a throwaway commit and build impurely:

```bash
git tag v1.2.3 -m test   # throwaway, delete after
LARRY_VERSION=$(git describe --tags --long | sed -E 's/^v//; s/-([0-9]+)-g[0-9a-f]+$/.\1/') \
  nix build --impure
grep version result/extension/manifest.json   # expect "1.2.3.<distance>"
git tag -d v1.2.3
```

Confirm the mapping: `v1.2.3-4-gabc123` → `1.2.3.4`, all integers ≤ 65535. If a tag has 0 commits since, `describe --long` yields `-0-g…` → `.0`. If the repo has **no tags yet**, `git describe --tags` fails — the release script must handle that (fall back to `0.0.0.<revCount>` or require a tag). Document this.

- [ ] **Step 6: Add a release helper.** Create `scripts/build-release.sh` (chmod +x) so the mapping lives in one place:

```bash
#!/usr/bin/env bash
set -euo pipefail
desc=$(git describe --tags --long 2>/dev/null) || { echo "no tags; tag a release first" >&2; exit 1; }
export LARRY_VERSION=$(printf '%s' "$desc" | sed -E 's/^v//; s/-([0-9]+)-g[0-9a-f]+$/.\1/')
echo "building larry $LARRY_VERSION" >&2
exec nix build --impure "$@"
```

- [ ] **Step 7: Commit**

```bash
git add flake.nix src/manifest.json scripts/build-release.sh
git commit -m "feat: derive manifest version from git describe (impure release build)"
```

- [ ] **Step 8: Document** in `README.md` Build: version is `MAJOR.MINOR.PATCH.DISTANCE` from `git describe` via `scripts/build-release.sh` (needs `--impure`); plain `nix build` uses the `1.0.<revCount>` dev fallback; nothing is committed. Commit `docs: explain git-describe versioning`.

---

## Task 3: Icon (`{ L }` monogram, SVG → PNG at build)

**Files:**
- Create: `src/icon.svg`
- Modify: `flake.nix` (build + install phases, devShell), `src/manifest.json`

**Design:** One vector source, rasterized to 16/32/48/128 PNG at build with `librsvg`'s `rsvg-convert` (in nixpkgs, reliable, small). No committed binaries.

- [ ] **Step 1: Create `src/icon.svg`** — a bold `{ L }` monogram, dark-on-light, high contrast so it reads at 16px. Use a 128×128 viewBox:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#1268c3"/>
  <g fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <!-- left brace -->
    <path d="M42 30 C33 30 33 58 24 64 C33 70 33 98 42 98"/>
    <!-- right brace -->
    <path d="M86 30 C95 30 95 58 104 64 C95 70 95 98 86 98"/>
  </g>
  <!-- L -->
  <path d="M56 40 L56 82 L74 82" fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

(If `rsvg-convert` renders the braces cramped at 16px, widen the `viewBox` padding or bump stroke width and re-check; the acceptance bar is "legible as `{L}` at 16px on both light and dark toolbars.")

- [ ] **Step 2: Add `rsvg-convert` to `nativeBuildInputs`** in the package derivation:

```nix
          nativeBuildInputs = [ pkgs.typescript pkgs.zip pkgs.librsvg ];
```

- [ ] **Step 3: In `buildPhase`**, after the jqjs shim lines, rasterize:

```bash
            for s in 16 32 48 128; do
              rsvg-convert -w $s -h $s src/icon.svg -o dist/icon-$s.png
            done
```

- [ ] **Step 4: In `installPhase`**, copy the PNGs into the extension:

```bash
            cp dist/icon-16.png dist/icon-32.png dist/icon-48.png dist/icon-128.png $out/extension/
```

- [ ] **Step 5: Wire the manifest.** In `src/manifest.json` add top-level `icons` and give the existing `action` a `default_icon`:

```json
  "icons": { "16": "icon-16.png", "32": "icon-32.png", "48": "icon-48.png", "128": "icon-128.png" },
  "action": {
    "default_title": "larry — show JSON viewer",
    "default_icon": { "16": "icon-16.png", "32": "icon-32.png" }
  },
```

- [ ] **Step 6: Verify.** `nix build`; `ls result/extension/*.png` shows four files; reload the extension and confirm the toolbar shows the `{L}` icon (not the generic monogram). Open the 128 png (`open result/extension/icon-128.png`) and eyeball it.

- [ ] **Step 7: Add `librsvg` to the devShell** too (so non-Nix contributors have `rsvg-convert`) and document icon regeneration in `README.md`.

- [ ] **Step 8: Commit**

```bash
git add src/icon.svg flake.nix src/manifest.json README.md
git commit -m "feat: add {L} monogram icon rendered from SVG at build"
```

---

## Task 4: Test & build harness (core.ts, esbuild, vitest, Playwright, prek, CI)

**This is the foundational task — do it before the feature tasks (5–12) so they can be TDD'd.** It's large; treat each step as its own review gate.

**Files:**
- Create: `package.json`, `vitest.config.ts`, `playwright.config.ts`, `src/core.ts`, `test/serve.mjs`, `test/unit/core.test.ts`, `test/unit/jqjs.test.ts`, `test/e2e/basic.spec.ts`, `test/fixtures/catalog.json`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`
- Modify: `flake.nix` (build → esbuild; devShell), `src/content.ts` (import from `./core`), `tsconfig.json`

**Design:** Move DOM-free logic into `src/core.ts` (exported) so it's unit-testable; `content.ts` imports it. **esbuild** bundles `content.ts` (+ its `core.ts` import) into the single classic IIFE `content.js`; `tsc --noEmit` keeps type safety. **vitest** tests `core.ts` directly (node, no browser). **Playwright** loads the *built* `result/extension/` into Chromium and drives real UI against a tiny local static server (so content-type is real `application/json`). `prek` runs typecheck + unit + format as `language: system` hooks. CI runs everything.

- [ ] **Step 1: Create `package.json`** (dev-only; `node_modules` is gitignored):

```json
{
  "name": "larry",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/node": "^22.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Run `nix develop -c npm install` (creates `package-lock.json` — **commit it**; it pins the dev toolchain).

- [ ] **Step 2: Extract `src/core.ts`.** Move every DOM-free symbol out of the IIFE in `content.ts` into an exported module. Move exactly: the `Json` and `Kind` type aliases; `kindOf`, `isContainer`, `childCountOf`, `entriesOf`, `childPath`, `spliceInto`, `formatBytes`; and `const URL_RE`. Prefix each with `export`. Example header of `src/core.ts`:

```typescript
// Pure, DOM-free helpers — unit-tested in test/unit/core.test.ts.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";

export function kindOf(v: Json): Kind { /* move body verbatim */ }
export function isContainer(k: Kind): boolean { /* … */ }
export function childCountOf(v: Json, k: Kind): number { /* … */ }
export function* entriesOf(v: Json, k: Kind): Generator<[string, Json]> { /* … */ }
export function childPath(parent: string, label: string, parentKind: Kind): string { /* … */ }
export function spliceInto<T>(arr: T[], index: number, items: T[]): void { /* … */ }
export function formatBytes(n: number): string { /* … */ }
export const URL_RE = /^https?:\/\/[^\s]+$/i;
```

In `content.ts`, delete those definitions and add at the top of the file (outside the IIFE, after the `declare const jqjs`):

```typescript
import { Json, Kind, kindOf, isContainer, childCountOf, entriesOf, childPath, spliceInto, formatBytes, URL_RE } from "./core";
```

Keep UI-only constants (`ROW_H`, `INDENT`, `OVERSCAN`, `STR_MAX`, `ROW_BUDGET`, `QUERY_CAP`) in `content.ts`.

- [ ] **Step 3: Migrate the build to esbuild.** In `tsconfig.json` set `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"noEmit": true`, and change `"include"` to `["src/content.ts", "src/core.ts"]`. In `flake.nix`: add `pkgs.esbuild` to `nativeBuildInputs`, and in `buildPhase` replace `tsc -p tsconfig.json` with:

```bash
            esbuild src/content.ts --bundle --format=iife --platform=browser \
              --target=es2020 --outfile=dist/content.js
```

Everything else in `buildPhase`/`installPhase` (jqjs shim, css, manifest, icons) is unchanged. `tsc` is no longer the emitter — type-checking moves to prek/CI (`tsc --noEmit`).

- [ ] **Step 4: Verify the build still works.** `nix build`; reload `result/extension/` and confirm the viewer still renders a JSON page (no behavior change — this is a pure refactor + build swap). `nix develop -c npm run typecheck` clean.

- [ ] **Step 5: Create `test/fixtures/catalog.json`** — a small object with `links`/`conformsTo` arrays (copy the STAC catalog shape). Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"], environment: "node" } });
```

Create `test/unit/core.test.ts` (import from source):

```typescript
import { describe, it, expect } from "vitest";
import { kindOf, childPath, spliceInto, formatBytes } from "../../src/core";

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
```

Create `test/unit/jqjs.test.ts` (folds in the old smoke test — guards jqjs version bumps by exercising the *shimmed* global):

```typescript
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
```

> `eval` here is **test-only** on a trusted artifact; shipped code stays eval-free. The `jqjs` test needs `nix build` to have run first; the unit workflow (Step 6) builds before testing.

- [ ] **Step 6: Verify unit tests.** `nix build && nix develop -c npm test` → all green.

- [ ] **Step 7: Set up Playwright E2E.** The extension must be loaded into Chromium (`--load-extension`), and content scripts need real content-types, so serve fixtures over HTTP. Create `test/serve.mjs`:

```js
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const root = new URL("./fixtures/", import.meta.url).pathname;
const types = { ".json": "application/json", ".ndjson": "text/plain" };
createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(req.url!.slice(1))));
    res.setHeader("content-type", types[extname(req.url!)] ?? "text/plain");
    res.end(body);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(8731, () => console.log("fixtures on :8731"));
```

Create `playwright.config.ts` (loads the built extension via a persistent context; headless "new" supports extensions):

```typescript
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const ext = fileURLToPath(new URL("./result/extension", import.meta.url));
export default defineConfig({
  testDir: "test/e2e",
  webServer: { command: "node test/serve.mjs", url: "http://localhost:8731/catalog.json", reuseExistingServer: true },
  use: {
    // Extensions require a persistent context with these args.
    launchOptions: { args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] },
  },
});
```

Create `test/e2e/basic.spec.ts`:

```typescript
import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

test("renders a JSON page as larry's tree", async () => {
  const ctx = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8731/catalog.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();
  await ctx.close();
});
```

> Playwright's own Chromium is downloaded by `npx playwright install chromium` (dev + CI). In Nix you *may* instead use `pkgs.playwright-driver.browsers` and set `PLAYWRIGHT_BROWSERS_PATH` — verify which works on this machine and report it. Loading unpacked extensions needs a non-default headless; if a test can't see the extension, switch that spec to `headless: false` under `xvfb-run` in CI.

- [ ] **Step 8: Verify E2E.** `nix build && nix develop -c npx playwright install chromium && nix develop -c npm run e2e` → the spec passes.

- [ ] **Step 9: Create `.pre-commit-config.yaml`** (all `language: system`, so prek provisions nothing — each command comes from the devShell):

```yaml
repos:
  - repo: local
    hooks:
      - id: typecheck
        name: tsc --noEmit
        language: system
        entry: tsc --noEmit -p tsconfig.json
        pass_filenames: false
        files: '\.ts$'
      - id: unit
        name: vitest
        language: system
        entry: bash -c 'vitest run'
        pass_filenames: false
        files: '\.(ts)$'
      - id: nixfmt
        name: nixfmt
        language: system
        entry: nixfmt
        files: '\.nix$'
      - id: manifest-json
        name: manifest valid JSON
        language: system
        entry: node -e "JSON.parse(require('fs').readFileSync('src/manifest.json','utf8'))"
        pass_filenames: false
        files: 'src/manifest\.json$'
```

> `vitest`'s hook runs the whole suite (the `jqjs` test needs a prior `nix build`; if that's too heavy for every commit, drop the `unit` hook and rely on CI — flag the choice to the user).

- [ ] **Step 10: Expand the devShell** in `flake.nix`:

```nix
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.typescript pkgs.nodejs pkgs.esbuild pkgs.librsvg pkgs.prek pkgs.nixfmt-rfc-style ];
          shellHook = ''
            echo "larry dev — nix build | npm test | npm run e2e | prek run --all-files"
          '';
        };
```

> Verify `pkgs.prek` and `pkgs.nixfmt-rfc-style` exist in the pinned nixpkgs (`nix eval nixpkgs#prek.pname`, `nix eval nixpkgs#nixfmt-rfc-style.pname`). If `prek` is missing, either bump the nixpkgs pin or fetch its release binary via `pkgs.fetchurl` + `runCommand` — report which. Then `nix develop -c prek install`.

- [ ] **Step 11: Create `.github/workflows/ci.yml`:**

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cachix/install-nix-action@v27
        with:
          extra_nix_config: "experimental-features = nix-command flakes"
      - run: nix build --print-build-logs
      - run: nix develop -c npm ci
      - run: nix develop -c npm run typecheck
      - run: nix develop -c npm test
      - run: nix develop -c npx playwright install --with-deps chromium
      - run: nix develop -c npm run e2e
      - run: nix develop -c prek run --all-files --show-diff-on-failure
```

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json vitest.config.ts playwright.config.ts \
        src/core.ts src/content.ts tsconfig.json flake.nix \
        test/ .pre-commit-config.yaml .github/workflows/ci.yml
git commit -m "chore: add core.ts, esbuild build, vitest + Playwright, prek, CI"
```

---

## Task 5: Guard `toggle()` against materializing a giant container

**Files:**
- Modify: `src/content.ts` (`toggle()`)

**Design:** `toggle()` expands a container by materializing all its children in one `spliceInto`. On a multi-million-element array this blows past Chrome's ~33M px element-height ceiling and stalls the tab. `expandLevel()` already guards with a 200k check; `toggle()` must too. Reuse the same threshold.

- [ ] **Step 1: Locate `toggle()`** in `src/content.ts`. In the `else` branch (expand), the code adds `row.path` to `this.expanded` and materializes children. Add a guard **before** mutating, using the row's own `childCount` as a fast lower bound plus the current row count:

```typescript
      } else {
        // Expand: refuse if this one node would explode the visible list.
        if (this.rows.length + row.childCount > 200000) {
          alert(`Expanding this would add ${row.childCount.toLocaleString()} rows and may stall the tab. Use the jq bar to filter it instead.`);
          return;
        }
        this.expanded.add(row.path);
        const sub: Row[] = [];
        for (const [label, child] of entriesOf(row.value, row.kind)) {
          this.materialize(this.makeRow(childPath(row.path, label, row.kind), label, child, row.depth + 1), sub);
        }
        sub.push(this.closeRow(row));
        spliceInto(this.rows, index + 1, sub);
      }
```

> `row.childCount` is the immediate child count — a correct lower bound. Deeper nested auto-expanded descendants can add more, but the guard's purpose is catching the pathological single-huge-container case, for which immediate count is decisive.

- [ ] **Step 2: Type-check.** `nix develop -c tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 3: Manual check.** Build; open a JSON doc containing an array with >200k elements (generate one: `node -e "process.stdout.write(JSON.stringify({big:Array.from({length:250000},(_ ,i)=>i)}))" > /tmp/big.json`, open via `file://` with file-URL access on). Click the `big` caret → expect the alert, no freeze, tree unchanged. Click a normal node → still expands fine.

- [ ] **Step 4: Commit**

```bash
git add src/content.ts
git commit -m "fix: guard toggle() against expanding a giant container"
```

---

## Task 6: Non-blocking jq execution (time-sliced + cancelable)

**Files:**
- Modify: `src/content.ts` (`runQuery`, add cancel state + a sliced runner), `src/content.css` (a "cancel" affordance is optional; reuse the status span)

**Design:** jqjs `compile(p)(input)` returns a **generator**. Instead of draining it synchronously (which freezes on big inputs), drain it in time slices: pull outputs in a loop until ~16ms elapse, then `await` a macrotask (`setTimeout(0)`) and continue. Track a monotonically increasing `queryRunId`; if a newer query starts (or Clear is pressed), the in-flight loop sees its id is stale and aborts. This keeps the tab responsive and makes queries cancelable — no Web Worker needed (a Worker can't run jqjs over the live parsed object without structured-cloning it, which defeats the purpose).

**Interfaces:**
- Consumes: existing `QUERY_CAP`, `this.original`, `showData`, `setQueryStatus`, `nextPaint`.
- Produces: `runQuery` becomes async-driven; add private `queryRunId: number`.

- [ ] **Step 1: Add run-id state.** Near the other private fields in `JsonView`:

```typescript
    private queryRunId = 0;
```

- [ ] **Step 2: Add a yield helper** at the IIFE scope near `nextPaint`:

```typescript
  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
```

- [ ] **Step 3: Replace `runQuery`** with a sliced, cancelable version:

```typescript
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
```

- [ ] **Step 4: Cancel on Clear/reset.** In `resetQuery`, bump the run id so any in-flight drain aborts:

```typescript
    private resetQuery(): void {
      this.queryRunId++;
      this.setQueryStatus("", false);
      this.showData(this.original, false);
    }
```

- [ ] **Step 5: Type-check** clean.

- [ ] **Step 6: Manual check.** Build; open a large JSON doc. Run a heavy generator query like `.. | .. | select(type=="string")`. Expect: the tab stays scrollable/responsive, status shows a rising `running… N` count. Type a new query mid-run and press Enter → the old run stops, the new result shows. Press Clear mid-run → stops, original restored. A normal small query still returns instantly.

- [ ] **Step 7: Commit**

```bash
git add src/content.ts
git commit -m "fix: run jq in cancelable time slices to keep the tab responsive"
```

---

## Task 7: NDJSON / JSON Lines support

**Files:**
- Modify: `src/content.ts` (parsing path in `activate()`), `README.md`
- Create: `test/fixtures/sample.ndjson`

**Design:** When the whole payload fails `JSON.parse`, attempt NDJSON: split on newlines, parse each non-blank line; if **every** non-blank line parses and there are ≥2 of them, treat the document as an **array** of those records and view it normally. jq then works via `.[]` (mirroring jq's per-record stream). Show a small note in the toolbar info that it was read as NDJSON. If NDJSON parsing also fails, fall through to the existing parse-error screen with the **original** error.

**Interfaces:**
- Consumes: `renderParseError`, `JsonView`.
- Produces: `JsonView` optionally told the source kind via a new constructor arg or a post-construct flag. Simplest: add an optional 3rd constructor param `note?: string` shown in the info line.

- [ ] **Step 1: Create `test/fixtures/sample.ndjson`:**

```
{"id": 1, "name": "alpha", "tags": ["x", "y"]}
{"id": 2, "name": "bravo", "tags": []}
{"id": 3, "name": "charlie", "tags": ["z"]}
```

- [ ] **Step 2: Add an NDJSON parser** at IIFE scope (near `getRawText`):

```typescript
  // Returns the parsed records if `raw` is newline-delimited JSON (≥2 records,
  // every non-blank line valid), else null.
  function tryParseNdjson(raw: string): Json[] | null {
    const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) return null;
    const out: Json[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line) as Json); }
      catch { return null; }
    }
    return out;
  }
```

- [ ] **Step 3: Wire it into `activate()`** — in the `catch` after the top-level `JSON.parse` fails, try NDJSON before erroring:

```typescript
    let data: Json;
    let note = "";
    try {
      data = JSON.parse(raw) as Json;
    } catch (err) {
      const nd = tryParseNdjson(raw);
      if (nd) { data = nd; note = "NDJSON"; }
      else { renderParseError(raw, err); return; }
    }
    new JsonView(data, raw, note).mount();
```

- [ ] **Step 4: Thread `note` into the info line.** In `JsonView`'s constructor add `note = ""` param and store it; in `buildToolbar`, where `info.textContent` is set, append the note when present:

```typescript
      info.textContent = `${kindOf(this.data)} · ${formatBytes(size)}${this.note ? " · " + this.note : ""}`;
```

Add the field `private readonly note: string;` and `this.note = note;` in the constructor (default `""` to keep existing call sites valid — but there's only one call site, updated in Step 3).

- [ ] **Step 5: Type-check** clean.

- [ ] **Step 6: Manual check.** Serve/open `test/fixtures/sample.ndjson`. It must render as a 3-element array; toolbar info shows `array · NN B · NDJSON`. Run jq `.[] | .name` → yields `"alpha" "bravo" "charlie"`. Confirm a genuinely malformed file still shows the original parse error.

- [ ] **Step 7: Document** NDJSON in `README.md` "Using it" and commit.

```bash
git add src/content.ts README.md test/fixtures/sample.ndjson
git commit -m "feat: detect NDJSON / JSON Lines and view as an array"
```

---

## Task 8: In-tree find (commandeer Ctrl/Cmd+F)

**Files:**
- Modify: `src/content.ts` (find bar UI, model search, match navigation), `src/content.css` (find bar + highlight)

**Design:** Native find can't see virtualized rows, so larry needs its own. Intercept `keydown` for Cmd/Ctrl+F, `preventDefault()` (suppresses Chrome's find on most pages), and toggle a **find bar**. Search runs over the **currently materialized `this.rows`** (matching is on visible rows — deliberately scoped, like the copy feature; searching collapsed-away nodes would require materializing everything). A match = a row whose key (`label`) or rendered scalar value contains the query (case-insensitive). Maintain an ordered list of matching row indices, a current position, prev/next (Enter / Shift-Enter, and buttons), and scroll-to + highlight. Re-run search when the query changes or the row set changes (expand/collapse). Esc closes and clears highlights.

**Interfaces:**
- Consumes: `this.rows`, `ROW_H`, `this.scroller`, `scheduleRender`, `renderRow`.
- Produces: private fields `findQuery: string`, `findMatches: number[]`, `findPos: number`, `findBar` elements; method `runFind()`, `stepFind(dir)`, `openFind()`, `closeFind()`, and a `rowMatchesFind(row)` helper used by `renderRow` to add a highlight class.

- [ ] **Step 1: Add fields** to `JsonView`:

```typescript
    private findQuery = "";
    private findMatches: number[] = [];
    private findPos = -1;
    private findBar!: HTMLElement;
    private findInput!: HTMLInputElement;
    private findCount!: HTMLElement;
```

- [ ] **Step 2: Build the find bar** — add `buildFindBar()` and append it inside the tree container so it can overlay. Call it from `mount()` (append to `app` after the query bar). Structure: a hidden bar with an input, a `N/M` counter, ↑/↓ buttons, and a close ✕.

```typescript
    private buildFindBar(): HTMLElement {
      const bar = this.findBar = document.createElement("div");
      bar.className = "jv-find";               // hidden by default (CSS)
      const input = this.findInput = document.createElement("input");
      input.type = "text";
      input.className = "jv-find-input";
      input.placeholder = "find in view";
      input.spellcheck = false;
      input.addEventListener("input", () => { this.findQuery = input.value; this.runFind(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.stepFind(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); }
      });
      const count = this.findCount = document.createElement("span");
      count.className = "jv-find-count";
      const prev = button("↑", () => this.stepFind(-1));
      const next = button("↓", () => this.stepFind(1));
      const close = button("✕", () => this.closeFind());
      bar.append(input, count, prev, next, close);
      return bar;
    }
```

- [ ] **Step 3: Add the searchable-text helper and matcher.** Matching text for a row is its label plus, for scalars, the rendered value:

```typescript
    private rowSearchText(row: Row): string {
      if (row.closing) return "";
      let s = row.label ?? "";
      if (row.kind === "string") s += " " + (row.value as string);
      else if (row.kind === "number" || row.kind === "boolean") s += " " + String(row.value);
      else if (row.kind === "null") s += " null";
      return s.toLowerCase();
    }

    private runFind(): void {
      const q = this.findQuery.trim().toLowerCase();
      this.findMatches = [];
      if (q) {
        for (let i = 0; i < this.rows.length; i++) {
          if (this.rowSearchText(this.rows[i]).includes(q)) this.findMatches.push(i);
        }
      }
      this.findPos = this.findMatches.length ? 0 : -1;
      this.updateFindCount();
      if (this.findPos >= 0) this.scrollToMatch();
      this.scheduleRender();  // re-render to paint highlight classes
    }

    private stepFind(dir: number): void {
      if (!this.findMatches.length) return;
      this.findPos = (this.findPos + dir + this.findMatches.length) % this.findMatches.length;
      this.updateFindCount();
      this.scrollToMatch();
      this.scheduleRender();
    }

    private updateFindCount(): void {
      const n = this.findMatches.length;
      this.findCount.textContent = n ? `${this.findPos + 1}/${n}` : (this.findQuery ? "0/0" : "");
    }

    private scrollToMatch(): void {
      const idx = this.findMatches[this.findPos];
      if (idx == null) return;
      const top = idx * ROW_H;
      const view = this.scroller.clientHeight;
      // center-ish the match
      this.scroller.scrollTop = Math.max(0, top - view / 2);
    }
```

- [ ] **Step 4: Open/close + global key intercept.** Add `openFind`/`closeFind` and a `keydown` listener on `window` (registered in `buildTree` or `mount`). Guard against typing in the query input.

```typescript
    private openFind(): void {
      this.findBar.classList.add("jv-open");
      this.findInput.focus();
      this.findInput.select();
    }
    private closeFind(): void {
      this.findBar.classList.remove("jv-open");
      this.findQuery = "";
      this.findMatches = [];
      this.findPos = -1;
      this.scheduleRender();
    }
```

Register the intercept in `mount()` after building UI:

```typescript
      window.addEventListener("keydown", (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "f" || e.key === "F")) {
          e.preventDefault();          // commandeer Chrome's find
          this.openFind();
        }
      });
```

- [ ] **Step 5: Highlight matches in `renderRow`.** After computing `el`, tag the current and other matches. Add near the top of `renderRow` (after `el` is created), a lookup — but building a Set each render is wasteful; instead compute membership via the fields. Add:

```typescript
      if (this.findMatches.length && this.rowSearchText(row) && this.findQuery &&
          this.rowSearchText(row).includes(this.findQuery.trim().toLowerCase())) {
        el.classList.add("jv-find-hit");
        if (this.findMatches[this.findPos] === index) el.classList.add("jv-find-current");
      }
```

- [ ] **Step 6: Re-run find when the row set changes.** In `rebuildRows()` (end) and after `toggle()`ّs splice, if `this.findQuery` is set, recompute matches. Add to `rebuildRows()`:

```typescript
      if (this.findQuery) this.runFind();
```

(Guard against recursion: `runFind` calls `scheduleRender`, not `rebuildRows`, so this is safe.) For `toggle()`, add `if (this.findQuery) this.runFind();` before `this.scheduleRender()`.

- [ ] **Step 7: CSS** in `src/content.css`:

```css
.jv-find {
  display: none;
  position: absolute;
  top: 6px; right: 16px;
  gap: 4px;
  align-items: center;
  padding: 4px 6px;
  background: var(--jv-bar);
  border: 1px solid var(--jv-line);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
  z-index: 5;
}
.jv-find.jv-open { display: flex; }
.jv-find-input { font: inherit; color: var(--jv-fg); background: var(--jv-bg); border: 1px solid var(--jv-line); border-radius: 4px; padding: 2px 6px; }
.jv-find-count { color: var(--jv-muted); min-width: 40px; text-align: center; }
.jv-find-hit { background: color-mix(in srgb, var(--jv-num) 22%, transparent); }
.jv-find-current { background: color-mix(in srgb, var(--jv-num) 45%, transparent); outline: 1px solid var(--jv-num); }
```

(The `.jv-scroller` is already `position: relative`, so the absolutely-positioned find bar anchors to it. If not, verify and add `position: relative` to the tree container.)

- [ ] **Step 8: Type-check** clean.

- [ ] **Step 9: Manual check.** Build; open the STAC catalog. Press Cmd/Ctrl+F → larry's find bar opens, Chrome's does NOT. Type `href` → matches highlight, counter shows `1/N`, view scrolls to first. Enter / Shift-Enter cycle and scroll. Expand a collapsed array, confirm matches recompute. Esc closes and clears. Confirm scrolling far away then Enter still jumps to matches (they're index-based, virtualization-safe).

- [ ] **Step 10: Commit**

```bash
git add src/content.ts src/content.css
git commit -m "feat: in-tree find that commandeers Ctrl/Cmd+F"
```

---

## Task 9: Copy path per row

**Files:**
- Modify: `src/content.ts` (row affordance + handler), `src/content.css`

**Design:** Each row already has a `⧉` copy-value affordance. Add a sibling that copies the row's **path** in jq form (e.g. `.links[3].href`), derived from `row.path` (which is stored in bracket form `$["links"][3]["href"]`). Convert bracket form to jq dot/bracket form.

**Interfaces:**
- Consumes: `row.path`, the delegated click handler, `copyNode` pattern.
- Produces: `pathToJq(path)` helper; `.jv-copypath` affordance; click branch.

- [ ] **Step 1: Add a converter** at IIFE scope. Input paths look like `$`, `$["a"]`, `$["a"][0]["b-c"]`:

```typescript
  // "$[\"links\"][3][\"href\"]"  ->  ".links[3].href"  (bracket-quote unsafe keys)
  function pathToJq(path: string): string {
    let out = "";
    const re = /\[("(?:[^"\\]|\\.)*"|\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) {
      const token = m[1];
      if (/^\d+$/.test(token)) out += `[${token}]`;
      else {
        const key = JSON.parse(token) as string;           // the raw key
        out += /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `.[${token}]`;
      }
    }
    return out === "" ? "." : out;
  }
```

- [ ] **Step 2: Render the affordance** in `renderRow`, next to the existing `⧉`. For non-closing rows only (the existing copy block is already skipped for closing rows because closing rows `return` earlier):

```typescript
      const copyPath = document.createElement("span");
      copyPath.className = "jv-copypath";
      copyPath.title = "Copy jq path to this value";
      copyPath.textContent = "⌖";
      el.appendChild(copyPath);
```

(Append it before the existing `jv-copy` so the two sit together at the right.)

- [ ] **Step 3: Handle the click** in the delegated handler, alongside the `jv-copy` branch:

```typescript
        const copyPathEl = target.closest<HTMLElement>(".jv-copypath");
        if (copyPathEl) {
          const r = this.rows[index];
          if (r) {
            navigator.clipboard.writeText(pathToJq(r.path)).then(
              () => { copyPathEl.classList.add("jv-copied"); setTimeout(() => copyPathEl.classList.remove("jv-copied"), 900); },
              () => {},
            );
          }
          return;
        }
```

- [ ] **Step 4: CSS** — mirror `.jv-copy`, offset so both fit:

```css
.jv-copypath {
  position: absolute; top: 0; right: 34px;
  display: none; padding: 0 5px;
  color: var(--jv-muted); cursor: pointer; user-select: none;
  background: var(--jv-hover); border: 1px solid var(--jv-line); border-radius: 4px;
}
.jv-row:hover .jv-copypath { display: inline-block; }
.jv-copypath:hover { color: var(--jv-fg); }
```

(Adjust the existing `.jv-copy` `right` if 34px collides — put value-copy at `right: 6px` and path-copy at `right: 34px`.)

- [ ] **Step 5: Type-check** clean.

- [ ] **Step 6: Manual check.** Build; hover a nested row (e.g. a `links[3].href`). The `⌖` appears; click copies `.links[3].href`; paste it into the jq bar → returns that value. Try a key needing quoting (e.g. `stac_version` is fine; a key with a dash like `content-type` must copy as `.["content-type"]`).

- [ ] **Step 7: Commit**

```bash
git add src/content.ts src/content.css
git commit -m "feat: per-row copy of the jq path to a value"
```

---

## Task 10: Keyboard navigation + ARIA tree roles

**Files:**
- Modify: `src/content.ts` (focus model, key handling, roles in `renderRow`), `src/content.css` (focus ring)

**Design:** Add a single "focused row" index. Arrow Up/Down move focus (and scroll into view), Right expands (or descends), Left collapses (or ascends to parent), Enter toggles. Rows get `role="treeitem"`, `aria-expanded`, `aria-level`; the scroller gets `role="tree"`. Focus is virtual (a `focusIndex` field + a CSS class on the focused row), since real DOM focus fights virtualization.

**Interfaces:**
- Consumes: `this.rows`, `toggle`, `scrollToMatch` pattern (extract a shared `scrollIndexIntoView(i)`).
- Produces: `focusIndex` field, `moveFocus(dir)`, `focusExpandCollapse(dir)`, keyboard handler; ARIA attrs in `renderRow`.

- [ ] **Step 1: Extract a shared scroll helper** (used by find and focus). Replace `scrollToMatch`'s body to call it:

```typescript
    private scrollIndexIntoView(idx: number): void {
      const top = idx * ROW_H;
      const viewTop = this.scroller.scrollTop;
      const viewH = this.scroller.clientHeight;
      if (top < viewTop) this.scroller.scrollTop = top;
      else if (top + ROW_H > viewTop + viewH) this.scroller.scrollTop = top + ROW_H - viewH;
    }
```

Change `scrollToMatch` to: `const idx = this.findMatches[this.findPos]; if (idx != null) this.scrollIndexIntoView(idx);`

- [ ] **Step 2: Add focus state** field: `private focusIndex = 0;`

- [ ] **Step 3: Keyboard handler** — register in `mount()` (same `window` keydown listener as find, or a second one). Ignore when typing in an input/textarea:

```typescript
      window.addEventListener("keydown", (e) => {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        switch (e.key) {
          case "ArrowDown": e.preventDefault(); this.moveFocus(1); break;
          case "ArrowUp": e.preventDefault(); this.moveFocus(-1); break;
          case "ArrowRight": e.preventDefault(); this.focusExpand(); break;
          case "ArrowLeft": e.preventDefault(); this.focusCollapse(); break;
          case "Enter": e.preventDefault(); this.toggle(this.focusIndex); break;
        }
      });
```

- [ ] **Step 4: Focus movement + expand/collapse:**

```typescript
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
      if (row?.expandable && !this.expanded.has(row.path)) this.toggle(this.focusIndex);
      else this.moveFocus(1); // already open (or a leaf): descend
    }

    private focusCollapse(): void {
      const row = this.rows[this.focusIndex];
      if (row?.expandable && this.expanded.has(row.path)) { this.toggle(this.focusIndex); return; }
      // else jump to parent (nearest shallower non-closing row above)
      const d = row ? row.depth : 0;
      for (let j = this.focusIndex - 1; j >= 0; j--) {
        if (!this.rows[j].closing && this.rows[j].depth < d) { this.focusIndex = j; this.scrollIndexIntoView(j); this.scheduleRender(); return; }
      }
    }
```

> Note: `toggle()` calls `scheduleRender` and mutates `this.rows`. After a collapse the `focusIndex` may now point past the end or at a different row; clamp in `renderWindow` or after toggle. Add at the end of `toggle()`: `if (this.focusIndex >= this.rows.length) this.focusIndex = this.rows.length - 1;`

- [ ] **Step 5: ARIA + focus class in `renderRow`.** For non-closing rows set roles; add focus class:

```typescript
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-level", String(row.depth + 1));
      if (row.expandable) el.setAttribute("aria-expanded", String(this.expanded.has(row.path)));
      if (index === this.focusIndex) el.classList.add("jv-focus");
```

And on the scroller (in `buildTree`): `this.scroller.setAttribute("role", "tree");` with `this.scroller.tabIndex = 0;` so it can hold focus.

- [ ] **Step 6: CSS** focus ring:

```css
.jv-focus { outline: 2px solid var(--jv-link); outline-offset: -2px; }
.jv-scroller:focus-visible { outline: none; }
```

- [ ] **Step 7: Type-check** clean.

- [ ] **Step 8: Manual check.** Build; click into the tree, then use ↑/↓ to move the focus ring (view scrolls to keep it visible), → to expand a container / descend, ← to collapse / jump to parent, Enter to toggle. Confirm closing-bracket rows are skipped by focus. Confirm typing in the jq/find inputs does NOT trigger navigation. Inspect an element to confirm `role="treeitem"` / `aria-expanded`.

- [ ] **Step 9: Commit**

```bash
git add src/content.ts src/content.css
git commit -m "feat: keyboard navigation and ARIA tree roles"
```

---

## Task 11: Forced activation on non-JSON pages

**Files:**
- Modify: `src/content.ts` (activation gate), `README.md`

**Design:** Keep the content-type gate narrow, but add a safe fallback: when the content-type isn't JSON, still activate **if** the page is a lone text/`<pre>` body whose trimmed text parses as JSON (or NDJSON). This covers JSON served as `text/plain` / wrong types and `file://` cases, without false-positives on real HTML (which has many elements). No `chrome.*`, no new permission. This is the "force it to run" answer; the `action` icon (in on-click mode) additionally lets the user inject larry on a page where it wasn't auto-added.

**Interfaces:**
- Consumes: `getRawText`, `tryParseNdjson` (Task 7), the existing gate.
- Produces: a `looksLikeLoneJsonBody()` predicate used to bypass the content-type early-return.

- [ ] **Step 1: Locate the activation gate** at the top of the IIFE:

```typescript
  const contentType = (document.contentType || "").toLowerCase();
  const looksLikeJson = contentType === "application/json" || contentType.endsWith("+json");
  if (!looksLikeJson) return;
```

- [ ] **Step 2: Replace the early return with a fallback probe.** The check must be cheap on HTML pages (bail on element count) and only parse when the body is a lone text/pre node:

```typescript
  const contentType = (document.contentType || "").toLowerCase();
  const looksLikeJson = contentType === "application/json" || contentType.endsWith("+json");
  if (!looksLikeJson && !looksLikeLoneJsonBody()) return;
```

- [ ] **Step 3: Add the predicate** (IIFE scope). It runs at `document_start` for auto-injection *and* post-load for click-injection, so handle both: at `document_start` the body may be empty — in that case, defer the decision to `activate()`, which already re-reads text. Keep the predicate conservative:

```typescript
  // True when the page is very likely a raw JSON/NDJSON payload served with a
  // non-JSON content-type: a body that is empty (still loading) or a single
  // text/<pre> node whose trimmed content starts with { [ or " . Cheap on HTML.
  function looksLikeLoneJsonBody(): boolean {
    const body = document.body;
    if (!body) return true;                      // document_start: decide later in activate()
    if (body.childElementCount > 1) return false;
    const el = body.firstElementChild;
    if (el && el.tagName !== "PRE") return false;
    const text = (el?.textContent ?? body.textContent ?? "").trimStart();
    return text.startsWith("{") || text.startsWith("[") || text.startsWith("\"");
  }
```

- [ ] **Step 4: Harden `activate()` against a false positive.** Because the gate can now let non-JSON through, `activate()` already parses and, on failure, tries NDJSON then shows the parse-error screen. But for a *forced* run on an ordinary text page we should **not** hijack the page with an error screen. Change `renderParseError` invocation so that, when the content-type was NOT json (i.e., this was a forced attempt) and parsing fails, we **bail silently** (restore nothing, leave the page) instead of showing the error UI. Implement by passing a `forced` flag:

```typescript
  // in activate():
  const forced = !(document.contentType || "").toLowerCase().match(/(^application\/json$|\+json$)/);
  // ...after JSON.parse + NDJSON both fail:
      else if (forced) { document.documentElement.classList.remove("jv-active"); return; }
      else { renderParseError(raw, err); return; }
```

- [ ] **Step 5: Type-check** clean.

- [ ] **Step 6: Manual check.** (a) Find/make an endpoint that returns JSON as `text/plain` (or save a `.json` as `.txt` and open via `file://`) → larry activates. (b) Open a normal HTML site → larry does NOT activate and does NOT flash an error. (c) A JSON page with correct content-type still works. (d) In on-click mode, clicking the icon on a text/plain JSON page injects and activates larry.

- [ ] **Step 7: Document** the fallback + the on-click "force" path in `README.md` and commit.

```bash
git add src/content.ts README.md
git commit -m "feat: activate on lone JSON/NDJSON bodies served as non-JSON types"
```

---

## Task 12: Privacy disclosure + store listing draft

**Files:**
- Create: `docs/PRIVACY.md`, `docs/store-listing.md`
- Modify: `README.md` (link them)

**Design:** larry collects nothing, makes no network calls, requests no permissions (host access via `<all_urls>` content script only). The Chrome Web Store still requires a privacy disclosure and a "single purpose" description. Draft both so publishing is a copy-paste later. No code.

- [ ] **Step 1: Create `docs/PRIVACY.md`:**

```markdown
# larry — Privacy Policy

larry does not collect, store, transmit, or sell any data.

- **No data collection.** larry processes the JSON already loaded in the tab,
  entirely on your device. It never sends page content, queries, or usage
  anywhere.
- **No network.** larry makes no network requests of its own. (It may re-`fetch`
  the *current page's own URL* with the browser's existing credentials only when
  it cannot read the already-rendered payload from the DOM — that request goes to
  the same server you already loaded, and nowhere else.)
- **No permissions beyond host access.** larry runs as a content script and
  requests no Chrome permissions (no storage, tabs, cookies, etc.).
- **No third parties, no analytics, no ads.**

Bundled dependency: jqjs (MIT), executed locally for the jq query feature.

Contact: <add contact email before publishing>.
```

> Verify the parenthetical about `fetch` matches `getRawText()` in `content.ts` (it re-fetches `location.href` with `credentials: "include"` as a fallback). If that behavior changes, update this doc.

- [ ] **Step 2: Create `docs/store-listing.md`:**

```markdown
# Chrome Web Store listing (draft)

**Name:** larry

**Summary (132 chars max):**
A trustworthy JSON viewer: pretty-prints, virtualizes huge docs, jq queries, find, copy — no permissions, no network, no eval.

**Single purpose:**
Render JSON (and NDJSON) responses as an interactive, searchable, queryable tree.

**Detailed description:**
larry replaces the browser's raw JSON display with a fast, collapsible tree that
handles tens of megabytes via virtualization. Filter and transform with jq
(pure-JS, no eval), find across the document, copy any value or its jq path, and
navigate by keyboard. It requests no permissions, makes no network calls, uses no
`chrome.*` APIs, and has one small, pinned, auditable dependency (jqjs).

**Permission justification:**
- Host access (`<all_urls>` content script): required to read and re-render JSON
  documents on any site you view. No data leaves the page. Use Chrome's
  "When you click the extension" site-access setting to restrict it.

**Category:** Developer Tools
**Privacy policy URL:** <hosted URL of docs/PRIVACY.md before publishing>
```

- [ ] **Step 3: Link both** from `README.md` (Publish section) and commit.

```bash
git add docs/PRIVACY.md docs/store-listing.md README.md
git commit -m "docs: add privacy policy and store listing draft"
```

---

## Per-feature test coverage (addendum — applies to Tasks 5–12)

Task 4 builds the harness; every feature task after it is **TDD where logic is pure, E2E where behavior is visual**. For each feature, add the listed tests *first* (red), implement (green), then the manual sanity. Put new pure logic in `src/core.ts` and unit-test it; `content.ts` imports it.

- **Task 5 (toggle guard):** E2E in `test/e2e/limits.spec.ts` — fixture with a >200k-element array; click its caret; assert a dialog/`alert` fires (Playwright `page.on("dialog")`) and no new `.jv-row` beyond the cap. No pure logic to unit-test.
- **Task 6 (non-blocking jq):** hard to unit-test timing; E2E in `test/e2e/query.spec.ts` — run a slow query on a large fixture, assert the page stays responsive (a second interaction resolves while "running…" shows) and that typing a new query supersedes the old result.
- **Task 7 (NDJSON):** **unit** `test/unit/core.test.ts` — move `tryParseNdjson` into `core.ts`; cases: valid ≥2-line NDJSON → array; single line → null; any bad line → null; blank lines ignored. **E2E** — serve `test/fixtures/sample.ndjson`, assert it renders as an array and info shows `NDJSON`.
- **Task 8 (find):** **unit** — extract the matcher (`rowSearchText`/a pure `matchRows(rows, query)`) into `core.ts`; cases: key match, string-value match, case-insensitivity, no-match. **E2E** `test/e2e/find.spec.ts` — press `Control+f`, assert larry's find bar (`.jv-find.jv-open`) appears and Chrome's does not intercept (the input receives focus), type a term, assert `.jv-find-current` and counter `1/N`, `Enter` advances.
- **Task 9 (copy path):** **unit** — `pathToJq` in `core.ts`; cases: root `$` → `.`; `$["a"][3]["b"]` → `.a[3].b`; dashed key `$["a-b"]` → `.["a-b"]`; numeric-looking key stays quoted. **E2E** — click a row's `⌖`, read `navigator.clipboard` (grant `clipboard-read` permission in the spec) and assert the jq path.
- **Task 10 (keyboard nav):** **E2E** `test/e2e/keyboard.spec.ts` — focus the tree, `ArrowDown`/`ArrowUp` move `.jv-focus`, `ArrowRight` expands, `ArrowLeft` collapses/ascends, `Enter` toggles; assert closing rows are skipped. Any pure focus-index math (e.g. next-non-closing index) → unit test.
- **Task 11 (forced activation):** **unit** — `looksLikeLoneJsonBody` logic is DOM-ish; extract the string test (`startsWithJsonChar(text)`) to `core.ts` and unit-test it. **E2E** — serve a `.json` fixture as `text/plain` (adjust `test/serve.mjs` to a `.txt` route) → larry activates; serve an HTML page → larry does **not** activate and shows no error UI.
- **Task 12 (docs):** no tests; a prek/CI check that `docs/PRIVACY.md` and `docs/store-listing.md` exist is optional.

Every task's final gate: `npm run typecheck` + `npm test` + `nix build` + `npm run e2e` all green (plus the manual sanity where noted).

## Self-review notes (already reconciled)

- **Naming consistency:** `runFind`/`stepFind`/`scrollIndexIntoView`/`focusExpand`/`focusCollapse`/`pathToJq`/`tryParseNdjson`/`looksLikeLoneJsonBody`/`macrotask`/`queryRunId` are used consistently across tasks 6–11. `scrollToMatch` (Task 8) is refactored to call `scrollIndexIntoView` in Task 10 Step 1 — do Task 8 before Task 10.
- **Ordering dependencies:** **Task 4 (harness) must come before Tasks 5–12** — they're TDD'd against it. Tasks 1–3 (license, version, icon) are independent config and can precede Task 4 in any order. Within features: Task 7 (`tryParseNdjson`, moved to `core.ts`) precedes Task 11 (reuses it); Task 8 (`scrollToMatch`) precedes Task 10 (extracts `scrollIndexIntoView`).
- **Constraint checks:** No task introduces `chrome.*` in `content.ts` or `eval` in **shipped** code (the `eval` in `test/unit/jqjs.test.ts` is test-only, on a trusted build artifact). Keep *no network* and *minimal permissions*. The single-file / zero-dep "principles" are dropped by decision — `core.ts` + esbuild + dev deps (`vitest`, `@playwright/test`, `esbuild`) are expected.
- **Closing-row invariant:** find (Task 8), keyboard nav (Task 10), and copy-path (Task 9) all skip `closing` rows.

## Open items to confirm during execution (flag to the user, don't guess silently)

1. **`prek` / `nixfmt-rfc-style` availability** in the pinned nixpkgs (Task 4 Step 10). Report the fallback if absent (bump pin or fetch release binary).
2. **Playwright + unpacked-extension loading** (Task 4 Step 7): confirm headless Chromium loads the extension on this machine; if not, run that spec headed under `xvfb-run` in CI, and decide npm-managed vs `pkgs.playwright-driver.browsers` for the browser — report which.
3. **esbuild bundle parity** (Task 4 Step 3–4): after the tsc→esbuild swap, confirm the viewer behaves identically before writing any feature — this is a refactor, not a behavior change.
4. **Ctrl+F suppression** is best-effort; if a page still opens Chrome's find in some edge case, note it — a known browser limitation, not a bug to chase.
5. **Icon legibility at 16px** (Task 3) — if `{L}` is muddy, adjust the SVG and re-render; don't ship an unreadable icon.
