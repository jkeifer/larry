import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

test("renders a JSON page as larry's tree", async () => {
  const ctx = await chromium.launchPersistentContext("", {
    // Headless Chromium does not reliably load unpacked extensions on this
    // machine; run headed (CI runs this under xvfb-run).
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8731/catalog.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();
  await ctx.close();
});
