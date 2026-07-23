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

test("the find bar and match gutter stay pinned as stepping scrolls a tall document", async ({
  page,
}) => {
  await page.goto("http://localhost:8731/many.json");
  await expect(page.locator(".jv-app")).toBeVisible();
  await expect(page.locator(".jv-row").first()).toBeVisible();

  await page.keyboard.press("Control+f");
  const input = page.locator(".jv-find-input");
  await input.fill("href");

  // The gutter appears with ticks, and exactly one is the current-match tick.
  const gutter = page.locator(".jv-find-gutter.jv-open");
  await expect(gutter).toBeVisible();
  expect(await page.locator(".jv-find-tick").count()).toBeGreaterThan(0);
  await expect(page.locator(".jv-find-tick-current")).toHaveCount(1);

  // Jump to the last match (Shift+Enter wraps backward), forcing a large
  // downward scroll of the viewport.
  const bar = page.locator(".jv-find");
  const before = (await bar.boundingBox())!;
  await input.press("Shift+Enter");
  const scroller = page.locator(".jv-scroller");
  const scrolled = await scroller.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  // Regression: the bar has NOT scrolled away with the content — it stays
  // pinned near the top and visible, with its Next/Prev buttons reachable.
  const after = (await bar.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  await expect(bar).toBeVisible();

  // Click-to-jump: clicking near the top of the gutter lands on one of the
  // first matches and scrolls the viewport back up.
  await gutter.click({ position: { x: 4, y: 3 } });
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(scrolled);
  const pos = Number((await page.locator(".jv-find-count").textContent())!.split("/")[0]);
  expect(pos).toBeLessThan(5);
});
