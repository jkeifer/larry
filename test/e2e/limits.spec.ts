import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

test("toggle() refuses to expand a container that would blow past the row cap", async () => {
  const ctx = await chromium.launchPersistentContext("", {
    // Headless Chromium does not reliably load unpacked extensions on this
    // machine; run headed (CI runs this under xvfb-run).
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8731/big-array.json");
  await expect(page.locator(".jv-app")).toBeVisible();

  const rowCountBefore = await page.locator(".jv-row").count();

  let dialogMessage = "";
  page.on("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });

  // The root object has a single key "big" whose value is the 250k-element
  // array. Clicking its key/caret should trigger toggle()'s expand branch.
  await page.locator(".jv-row", { hasText: "big" }).first().locator(".jv-key").click();

  await expect.poll(() => dialogMessage).not.toBe("");
  expect(dialogMessage).toMatch(/rows|stall/i);

  // No rows were materialized past the cap: row count is unchanged, and the
  // array is not marked expanded.
  const rowCountAfter = await page.locator(".jv-row").count();
  expect(rowCountAfter).toBe(rowCountBefore);

  await ctx.close();
});
