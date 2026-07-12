import { test, expect } from "./fixtures";

test("Ctrl+F opens larry's in-tree find and navigates matches", async ({ page }) => {
  await page.goto("http://localhost:8731/catalog.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();

  // Commandeer Ctrl+F: larry's bar opens (Chrome's native find can't be
  // asserted absent, but the bar opening + input focus proves the intercept
  // fired and preventDefault ran).
  await page.keyboard.press("Control+f");
  const bar = page.locator(".jv-find.jv-open");
  await expect(bar).toBeVisible();
  const input = page.locator(".jv-find-input");
  await expect(input).toBeFocused();

  // Type a term present in the STAC catalog.
  await input.fill("href");
  await expect(page.locator(".jv-find-current")).toHaveCount(1);

  // Counter shows 1/N with N >= 2 so we can observe advancement.
  const counter = page.locator(".jv-find-count");
  await expect(counter).toHaveText(/^1\/\d+$/);
  const total = Number((await counter.textContent())!.split("/")[1]);
  expect(total).toBeGreaterThan(1);

  // Enter advances the current match position.
  await input.press("Enter");
  await expect(counter).toHaveText(`2/${total}`);

  // Shift+Enter steps back.
  await input.press("Shift+Enter");
  await expect(counter).toHaveText(`1/${total}`);

  // Esc closes the bar and clears highlights.
  await input.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.locator(".jv-find-hit")).toHaveCount(0);
});
