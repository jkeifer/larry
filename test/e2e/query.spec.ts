import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

// The jq bar drains jqjs's generator over `/big-array.json` (a 250k-element
// array, served on the fly by test/serve.mjs). `.big[] | select(. % 2 == 0)`
// yields 125k outputs and takes long enough (tens of ms, well over the 16ms
// slice budget) to span several time slices — the window Task 6 exists to
// keep the tab responsive during, and the window a superseding query must be
// able to cancel into.
const HEAVY_QUERY = ".big[] | select(. % 2 == 0)";

test.describe("jq execution (time-sliced, cancelable)", () => {
  test("a second query supersedes an in-flight first query", async () => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const page = await ctx.newPage();
    await page.goto("http://localhost:8731/big-array.json");
    await expect(page.locator(".jv-app")).toBeVisible();

    const input = page.locator(".jv-query-input");

    // Start the heavy query — its result (125,000 rows) differs sharply from
    // the second query below (a single number).
    await input.fill(HEAVY_QUERY);
    await input.press("Enter");

    // Immediately (while the heavy run is still in flight — its own slicing
    // guarantees it hasn't finished draining 125k outputs yet) submit a
    // second, distinct query.
    await input.fill(".big | length");
    await input.press("Enter");

    // The final rendered tree must reflect the SECOND query only: a single
    // scalar row showing 250000, never the heavy query's array of 125k rows.
    await expect(page.locator(".jv-query-status")).toHaveText(/1 result/);
    await expect(page.locator(".jv-row")).toHaveCount(1);
    await expect(page.locator(".jv-row").first()).toContainText("250000");

    await ctx.close();
  });

  test("status shows a running state during a heavy query, then a result count", async () => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const page = await ctx.newPage();
    await page.goto("http://localhost:8731/big-array.json");
    await expect(page.locator(".jv-app")).toBeVisible();

    const input = page.locator(".jv-query-input");
    const status = page.locator(".jv-query-status");

    await input.fill(HEAVY_QUERY);
    await input.press("Enter");

    // Mid-run: status shows a "running…" state (the sliced drain reports
    // progress between macrotask yields, so this is not a one-frame flash).
    await expect(status).toHaveText(/running…/);

    // Once it completes, the status reflects the final result count.
    await expect(status).toHaveText(/125000 results?/, { timeout: 15000 });

    await ctx.close();
  });

  test("Clear cancels an in-flight query and restores the original document", async () => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const page = await ctx.newPage();
    await page.goto("http://localhost:8731/big-array.json");
    await expect(page.locator(".jv-app")).toBeVisible();

    const input = page.locator(".jv-query-input");
    await input.fill(HEAVY_QUERY);
    await input.press("Enter");
    await expect(page.locator(".jv-query-status")).toHaveText(/running…/);

    await page.locator(".jv-btn", { hasText: "Clear" }).click();

    // Cancelled: status clears and the original document (root object with
    // its single "big" key, collapsed — 3 rows: open brace, the key, close
    // brace) is restored, never the heavy query's 125k-row result.
    await expect(page.locator(".jv-query-status")).toBeHidden();
    await expect(page.locator(".jv-row")).toHaveCount(3);
    await expect(page.locator(".jv-row").nth(1)).toContainText("big");

    await ctx.close();
  });
});
