import { test, expect } from "./fixtures";

// larry's activation gate only fires for content-type application/json (or
// +json); NDJSON detection runs *after* that gate passes and the whole-body
// JSON.parse fails. So the realistic trigger is NDJSON served with
// content-type application/json — test/serve.mjs exposes that at
// /sample-ndjson-as-json. Serving the fixture as .ndjson (text/plain) would
// never reach larry's parser at all (that's Task 11's forced-activation
// fallback).

test("NDJSON body served as application/json renders as an array with a toolbar note", async ({
  page,
}) => {
  await page.goto("http://localhost:8731/sample-ndjson-as-json");
  await expect(page.locator(".jv-app")).toBeVisible();

  // sample.ndjson has 3 records, each an object with 3 keys — the tree opens
  // fully by default, so multiple .jv-row elements should be visible.
  const rowCount = await page.locator(".jv-row").count();
  expect(rowCount).toBeGreaterThan(1);

  const info = page.locator(".jv-info");
  await expect(info).toContainText("array");
  await expect(info).toContainText("NDJSON");
});

test("a genuinely malformed body still shows the parse-error screen", async ({ page }) => {
  await page.goto("http://localhost:8731/malformed-as-json");

  // renderParseError() renders a .jv-app with a .jv-toolbar error message and
  // the raw payload in a .jv-raw <pre> — no .jv-row tree is ever built.
  await expect(page.locator(".jv-raw")).toBeVisible();
  await expect(page.locator(".jv-toolbar")).toContainText(/not valid json/i);
  await expect(page.locator(".jv-row")).toHaveCount(0);
});
