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
