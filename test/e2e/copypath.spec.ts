import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

test("clicking a row's copy-path affordance copies the jq path to the clipboard", async () => {
  const ctx = await chromium.launchPersistentContext("", {
    // Headless Chromium does not reliably load unpacked extensions on this
    // machine; run headed (CI runs this under xvfb-run).
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  // Clipboard access requires an explicit grant in a persistent context —
  // without it, navigator.clipboard.writeText()/readText() reject silently.
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);

  const page = await ctx.newPage();
  await page.goto("http://localhost:8731/catalog.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();

  // The catalog fixture is small enough that larry auto-expands the whole
  // tree on load, so every row (including nested "href" rows under
  // "links") is already rendered — no manual expand needed. The fixture's
  // "links" array has 4 items; the 4th "href" row (index 3) is the one
  // whose jq path we assert below.
  const hrefRow = page.locator(".jv-row", { hasText: "href" }).nth(3);
  await hrefRow.hover();
  await hrefRow.locator(".jv-copypath").click();

  // Visual feedback: the affordance flashes .jv-copied briefly.
  await expect(hrefRow.locator(".jv-copypath")).toHaveClass(/jv-copied/);

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(".links[3].href");

  await ctx.close();
});
