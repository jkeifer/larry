import { test, expect } from "./fixtures";

// Task 11: larry's content-type gate is narrow (application/json or
// +json), but a lone JSON/NDJSON body served with a *wrong* content-type (e.g.
// text/plain, or a saved file:// page) should still activate larry. The
// dangerous failure mode this guards against: naively deferring the decision
// to activate() at document_start (body not yet populated) could let *every*
// ordinary HTML page slip through the gate and then hit getRawText()'s fetch
// fallback once the body has many elements. That must never happen — see the
// second test below.

test("JSON served with content-type text/plain still activates larry", async ({ page }) => {
  await page.goto("http://localhost:8731/catalog-as-text-plain");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();
});

test("an ordinary HTML page stays inert: no larry UI, no error screen, page content intact, and no re-fetch", async ({
  page,
}) => {
  // Count requests to the page's own URL — if activate() ever falls through
  // to getRawText()'s fetch(location.href) fallback on this page, we'd see a
  // second request for the same document. That is exactly the regression
  // this task guards against.
  const requestedUrls: string[] = [];
  page.on("request", (req) => requestedUrls.push(req.url()));

  await page.goto("http://localhost:8731/page.html");

  // larry must never mount its UI or an error screen on this page.
  await expect(page.locator(".jv-app")).toHaveCount(0);
  await expect(page.locator(".jv-loading")).toHaveCount(0);
  await expect(page.locator(".jv-raw")).toHaveCount(0);

  // The page's own content must be untouched.
  await expect(page.locator("#marker")).toHaveText(
    "This is an ordinary HTML page. larry must stay inert here.",
  );
  await expect(page.locator("#site-header")).toBeVisible();
  await expect(page.locator("#site-footer")).toBeVisible();

  // The document root must not carry larry's activation marker.
  const hasActiveClass = await page.evaluate(() =>
    document.documentElement.classList.contains("jv-active"),
  );
  expect(hasActiveClass).toBe(false);

  // No re-fetch of the page's own document.
  const selfRequests = requestedUrls.filter((u) => u.endsWith("/page.html"));
  expect(selfRequests.length).toBe(1);
});
