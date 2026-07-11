# larry

A trustworthy JSON viewer browser extension for Chromium browsers that pretty-prints,
syntax-highlights, makes URLs clickable, and collapses/expands — built to be
*audited*, not just used.

- **One vetted dependency, zero permissions, zero network, no eval.** The
  viewer is one content script (`src/content.ts`) plus a stylesheet. The **jq
  query** feature adds a single pure-JavaScript dependency,
  [jqjs](https://github.com/mwh/jqjs) (MIT) — a hand-written jq interpreter with
  **no `eval`/`Function`** and no network. It uses no `chrome.*` APIs and
  requests no permissions. jqjs is **not committed here**: it's pinned by commit
  and hash in `flake.lock` and fetched at build time, so it stays reproducible
  and auditable (its ~3.4k lines are the only code beyond this repo).
- **Handles tens of MB.** The tree is *virtualized* — only the rows in the
  viewport exist as DOM nodes. Documents expand fully by default; only when a
  full expansion would exceed ~100k rows does it collapse the deepest levels to
  stay within budget.
- **Inert on non-JSON pages.** It returns immediately unless the response
  `Content-Type` ends in `json`.

## Using it

- **Expand / collapse.** Click a key or caret to toggle a node. Small and
  medium documents open fully; very large ones open to the depth that fits, and
  you drill down from there. The toolbar's **Expand level** / **Collapse level**
  step the whole tree's open frontier one layer outward or inward per press.
- **Links.** A string that is a whole `http(s)` URL renders as a link and
  navigates in the **same tab** (Cmd/Ctrl-click for a new tab).
- **Copy a node.** Hover any row and click the `⧉` to copy that node's whole
  subtree as pretty-printed JSON — regardless of how large it is or how deeply
  it's collapsed.
- **Copy a selection.** Select across rows and copy: you get pretty-printed
  JSON with real indentation — a single node comes out as valid JSON, several
  siblings as an object/array fragment. Selection only reaches rows currently
  on screen (off-screen rows aren't in the DOM); for anything larger use the
  per-row `⧉`. Selecting part of a single value still copies just that text.
- **Toolbar Copy / View raw.** **Copy** puts the entire document on the
  clipboard; **View raw** shows the untouched payload.
- **jq query.** The bar under the toolbar runs a [jq](https://jqlang.github.io/jq/)
  program (via jqjs) over the document — type a filter, press Enter, and the
  result renders in the same tree; **Clear** (or Esc) restores the original.
  **Examples** opens a drawer of common patterns, including deep-search filters
  like `.. | select(type == "string")` and `[paths]` for locating keys. It's
  *core* jq — most of the language, but not every builtin.

## Layout

```
src/content.ts     the entire viewer (parse, virtualized tree, highlight, links, jq bar)
src/content.css    styling (light/dark, fixed 20px row height)
src/manifest.json  MV3 manifest — no permissions; loads jqjs.js then content.js
src/icon.svg       `{ L }` monogram — rasterized to icon-{16,32,48,128}.png at build
flake.nix          build derivation + jqjs input + NixOS/nix-darwin force-install modules
(jqjs.js)          jq engine — fetched from the pinned flake input and shimmed at build time
```

### Icon

The toolbar icon is a single vector source, `src/icon.svg` — no PNGs are
committed. The build rasterizes it at 16/32/48/128px with `rsvg-convert`
(from `librsvg`, in `nativeBuildInputs` and the dev shell) and copies the
results into `dist/` / `$out/extension`. To change the icon, edit
`src/icon.svg` and rebuild:

```sh
nix build
open result/extension/icon-128.png   # eyeball it
```

Without Nix, install `librsvg` yourself and run the equivalent loop:

```sh
for s in 16 32 48 128; do rsvg-convert -w $s -h $s src/icon.svg -o dist/icon-$s.png; done
```

## Build

With Nix (handles jqjs for you):

```sh
nix build            # → result/extension (loadable) and result/json-viewer.zip (store upload)
```

To update the pinned jqjs version, bump the lock and rebuild:

```sh
nix flake update jqjs   # rewrites flake.lock to jqjs' latest commit + hash
nix build               # re-test the query bar afterwards (see the shim note below)
```

Without Nix you must also fetch jqjs yourself and expose it as a global (a
content script can't be an ES module), matching what `flake.nix` does:

```sh
npm i -D typescript
npx tsc -p tsconfig.json
cp src/content.css src/manifest.json dist/
# pin <rev> to the same commit as flake.lock:
curl -fsSL "https://raw.githubusercontent.com/mwh/jqjs/<rev>/jq.js" \
  | grep -v '^export ' > dist/jqjs.js
printf '\nglobalThis.jqjs = { compile, prettyPrint, compileNode, formats };\n' >> dist/jqjs.js
# dist/ is now loadable and zippable
```

The build strips jqjs' `export` lines and appends a global assignment. That
shim assumes the exported names stay `compile, prettyPrint, compileNode,
formats` — after a version bump, smoke-test the query bar in case they changed.

### Versioning

The built `manifest.json`'s `version` is `MAJOR.MINOR.PATCH.DISTANCE` —
Chrome requires 1-4 integer components — derived from `git describe --tags
--long` via `scripts/build-release.sh`:

```sh
./scripts/build-release.sh   # tag first: git tag v1.2.3; needs --impure (reads git outside the sandbox)
```

That script maps e.g. `v1.2.3-4-gabc123` → `1.2.3.4` and fails if the repo
has no tags yet — tag a release before running it. A plain `nix build` (no
tag, no `--impure`) instead uses the pure dev fallback `1.0.<revCount>`
(`git log --oneline | wc -l`-equivalent commit count), or `1.0.0` on a dirty
tree. Nothing is ever committed back to `src/manifest.json`, which keeps a
`"0.0.0"` placeholder that the build overwrites.

## Try it locally (dev)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `dist/` (or `result/extension`)
3. Open any `application/json` URL.

For local `file://` JSON, also toggle **Allow access to file URLs** on the
extension's card.

### Run only when you click it

larry ships a toolbar `action` (an icon) but no popup and no `chrome.*` code. If
you'd rather it not touch every page, open its menu → **This can read and change
site data → When you click the extension**. Chrome then withholds the content
script until you click larry's icon on a page, and injects it (JS + CSS) at that
point — no scripting APIs or extra permissions involved. Trade-off: click-to-run
happens *after* the page has painted, so you'll briefly see the raw JSON before
it's replaced (the pre-paint no-flash swap only happens in auto-run mode).

## Publish (strategy A: force-install by ID on every machine)

You chose to publish so others can use it too. That means a **public** listing
(discoverable in the store) rather than unlisted (link-only). Either works for
your own force-install; public just adds discoverability.

1. Create a Chrome Web Store developer account. **Put a hardware security key on
   this account.** A stolen or phished developer account is the single most
   common way "trusted" extensions get hijacked — it is the exact vector you're
   trying to escape, now relocated to an account you control, so lock it down.
2. Upload `json-viewer.zip`. It already bundles the 16/32/48/128 icons
   rasterized from `src/icon.svg`; you'll still need store copy to pass review.
3. After it's published, copy the **32-character extension ID** from the
   listing URL. That ID is what the Nix modules force-install.

Publishing re-introduces auto-update *from your account only* — no third party
can push to you. With the hardware key in place, that's a materially different
risk than trusting a stranger's extension.

## Wire it into your systems

Add this repo as a flake input, then enable the module on each host with your
published ID.

**NixOS / `nixos-rebuild`:**

```nix
{
  inputs.json-viewer.url = "github:you/json-viewer";

  # in your host module:
  imports = [ inputs.json-viewer.nixosModules.default ];
  programs.jsonViewer = {
    enable = true;
    extensionId = "your32charidfromthestorelisting00";
    # updateUrl defaults to the Chrome Web Store; leave it.
  };
}
```

This writes `/etc/chromium/policies/managed/json-viewer.json` (and the
Chrome path). Restart the browser, then confirm at `chrome://policy`.

**nix-darwin:**

```nix
{
  imports = [ inputs.json-viewer.darwinModules.default ];
  programs.jsonViewer = {
    enable = true;
    extensionId = "your32charidfromthestorelisting00";
  };
}
```

Quit and reopen Chrome, then check `chrome://policy`.

### macOS caveat (the one fiddly bit)

The darwin module writes the `com.google.Chrome` managed-preferences domain via
`defaults`. Chrome usually honors this, but on some macOS versions it only
treats policy as mandatory when it arrives as a **configuration profile**. If
the extension doesn't appear at `chrome://policy` after a rebuild + restart,
install this profile once (`sudo profiles install -path json-viewer.mobileconfig`
or double-click it) — it carries the same policy:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadIdentifier</key><string>local.jsonviewer.chrome</string>
  <key>PayloadUUID</key><string>PUT-A-UUID-HERE</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadContent</key><array><dict>
    <key>PayloadType</key><string>com.google.Chrome</string>
    <key>PayloadIdentifier</key><string>local.jsonviewer.chrome.payload</string>
    <key>PayloadUUID</key><string>PUT-ANOTHER-UUID-HERE</string>
    <key>PayloadVersion</key><integer>1</integer>
    <key>ExtensionSettings</key><dict>
      <key>your32charidfromthestorelisting00</key><dict>
        <key>installation_mode</key><string>force_installed</string>
        <key>update_url</key><string>https://clients2.google.com/service/update2/crx</string>
      </dict>
    </dict>
  </dict></array>
</dict></plist>
```

(Force-installing an *outside-the-store* extension on macOS would require MDM
enrollment — which is why strategy A publishes to the store instead.)

## Notes on the large-JSON design

Parsing runs on the main thread, not in a Worker. For tens of MB, `JSON.parse`
costs a few hundred ms once, and structured-cloning the parsed tree back out of
a Worker often costs *more* than the parse it was meant to offload. Because
rendering is lazy (virtualized + collapse-by-default), `JSON.parse` is the only
unavoidable full pass, so it runs directly after one yielded paint for the
loading state. If you ever need *hundreds* of MB, the upgrade is a Worker that
parses into a transferable `ArrayBuffer` index and streams rows from it — a
bigger change, deliberately not taken here to keep the code auditable.

Auto-expansion is bounded the same way. Virtualization caps the *DOM*, but the
row model and the scroll-sizer height are not — and browsers cap element height
near 33 M px (~1.6 M rows at 20 px each). So the viewer expands everything only
while it stays under a ~100k-row budget; past that it keeps the shallow levels
open and collapses the deepest ones, which you can still expand by hand.

## License

MIT (or your choice) — it's yours to relicense when you open-source it. Bundles jqjs (MIT, © Michael Homer) at build time; its license header is preserved in the shipped `jqjs.js`.
