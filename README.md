# Trustworthy JSON Viewer

A JSON viewer browser extension for Chromium browsers that pretty-prints,
syntax-highlights, makes URLs clickable, and collapses/expands — built to be
*audited*, not just used.

- **Zero runtime dependencies, zero permissions, zero network.** The whole
  extension is one content script (`src/content.ts`) plus a stylesheet. It uses
  no `chrome.*` APIs and requests no permissions, so the Web Store review is
  trivial and there is nothing to trust but the code in front of you.
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

## Layout

```
src/content.ts     the entire viewer (parse, virtualized tree, highlight, links)
src/content.css    styling (light/dark, fixed 20px row height)
src/manifest.json  MV3 manifest — no permissions
flake.nix          build derivation + NixOS and nix-darwin force-install modules
```

## Build

With Nix:

```sh
nix build            # → result/extension (loadable) and result/json-viewer.zip (store upload)
```

Without Nix:

```sh
npm i -D typescript
npx tsc -p tsconfig.json
cp src/content.css src/manifest.json dist/
# dist/ is now loadable and zippable
```

## Try it locally (dev)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `dist/` (or `result/extension`)
3. Open any `application/json` URL.

For local `file://` JSON, also toggle **Allow access to file URLs** on the
extension's card.

## Publish (strategy A: force-install by ID on every machine)

You chose to publish so others can use it too. That means a **public** listing
(discoverable in the store) rather than unlisted (link-only). Either works for
your own force-install; public just adds discoverability.

1. Create a Chrome Web Store developer account. **Put a hardware security key on
   this account.** A stolen or phished developer account is the single most
   common way "trusted" extensions get hijacked — it is the exact vector you're
   trying to escape, now relocated to an account you control, so lock it down.
2. Upload `json-viewer.zip`. You'll need a 128×128 icon and store copy to pass
   review (add an `icons` field to the manifest before zipping).
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

MIT (or your choice) — it's yours to relicense when you open-source it.
