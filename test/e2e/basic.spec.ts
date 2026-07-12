import { test, expect } from "./fixtures";

test("renders a JSON page as larry's tree", async ({ page }) => {
  await page.goto("http://localhost:8731/catalog.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();
});
