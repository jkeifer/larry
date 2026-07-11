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
