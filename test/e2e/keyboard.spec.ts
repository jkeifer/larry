import { test, expect, chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

test.describe("keyboard navigation + ARIA tree roles", () => {
  test("arrows move focus, expand/collapse, Enter toggles; inputs suppress nav", async () => {
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

    // ARIA: scroller is a tree, focusable.
    const scroller = page.locator(".jv-scroller");
    await expect(scroller).toHaveAttribute("role", "tree");
    await expect(scroller).toHaveAttribute("tabindex", "0");

    // Non-closing rows carry treeitem role + aria-level.
    const firstRow = page.locator('.jv-row[data-index="0"]');
    await expect(firstRow).toHaveAttribute("role", "treeitem");
    await expect(firstRow).toHaveAttribute("aria-level", "1");

    // The root row is expandable and starts auto-expanded (small doc).
    await expect(firstRow).toHaveAttribute("aria-expanded", "true");

    // Focus the tree by clicking on row content away from the caret (x=200),
    // so we don't accidentally toggle the root closed.
    await scroller.click({ position: { x: 200, y: 2 } });

    const focusRing = () => page.locator(".jv-focus");

    // ArrowDown moves focus to row 1, skipping no closing rows at the top.
    await page.keyboard.press("ArrowDown");
    await expect(focusRing()).toHaveAttribute("data-index", "1");

    await page.keyboard.press("ArrowDown");
    await expect(focusRing()).toHaveAttribute("data-index", "2");

    // ArrowUp moves back.
    await page.keyboard.press("ArrowUp");
    await expect(focusRing()).toHaveAttribute("data-index", "1");

    // Move down to the "conformsTo" array row. The fixture's DFS row order is
    // fixed (0 $root, 1 type, 2 id, 3 stac_version, 4 description, 5 conformsTo,
    // ...), so walk down by the known offset from the current row (1).
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(focusRing().locator(".jv-key")).toHaveText("conformsTo");
    const conformsIndex = Number(await focusRing().getAttribute("data-index"));

    // conformsTo is expanded by default (small doc auto-expands). Collapse
    // it with ArrowLeft, confirm aria-expanded flips to false and the rows
    // shrink (its two string children disappear from the DOM count-wise via
    // aria-expanded, verified directly).
    await expect(focusRing()).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(`.jv-row[data-index="${conformsIndex}"]`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Focus should remain on the same (still valid) row after collapsing.
    await expect(focusRing()).toHaveAttribute("data-index", String(conformsIndex));

    // ArrowRight re-expands it.
    await page.keyboard.press("ArrowRight");
    await expect(focusRing()).toHaveAttribute("aria-expanded", "true");

    // ArrowRight again on an already-open container descends into its
    // first child (skipping the closing row is implicit since children
    // exist immediately below). Assert the exact expected index so the
    // matcher's polling waits out the rAF-scheduled render before we read.
    await page.keyboard.press("ArrowRight");
    await expect(focusRing()).toHaveAttribute("data-index", String(conformsIndex + 1));
    const descendedIndex = conformsIndex + 1;

    // Enter toggles: move focus to a leaf-less scalar row (already there);
    // instead verify Enter on an expandable row toggles it. Move focus back
    // up to the conformsTo row and press Enter to collapse.
    await page.keyboard.press("ArrowUp");
    await expect(focusRing()).toHaveAttribute("data-index", String(conformsIndex));
    await page.keyboard.press("Enter");
    await expect(page.locator(`.jv-row[data-index="${conformsIndex}"]`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Closing rows are skipped by focus in both directions. Expand again,
    // then move down past its children until we're one step from the
    // closing "]" row — focus must land on the row AFTER the closing row,
    // not the closing row itself. Assert no focused row ever has an empty
    // (closing) marker: a closing row has no data role treeitem attributes.
    await page.keyboard.press("Enter"); // re-expand conformsTo
    await expect(page.locator(`.jv-row[data-index="${conformsIndex}"]`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Step through several ArrowDowns and assert the focused row is never a
    // synthetic closing bracket (closing rows render only "]"/"}" and carry
    // no role="treeitem").
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowDown");
      const ring = focusRing();
      await expect(ring).toHaveAttribute("role", "treeitem");
    }
    // And walking back up the same number of steps must also never land on
    // a closing row.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("ArrowUp");
      const ring = focusRing();
      await expect(ring).toHaveAttribute("role", "treeitem");
    }

    await ctx.close();
  });

  test("typing arrows in the jq/find inputs does not move .jv-focus", async () => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const page = await ctx.newPage();
    await page.goto("http://localhost:8731/catalog.json");
    await expect(page.locator(".jv-row").first()).toBeVisible();

    // Establish a baseline focus index via a tree click. Assert first (rather
    // than reading immediately) so the assertion's built-in polling waits out
    // the rAF-scheduled render before we snapshot the value.
    await page.locator(".jv-scroller").click({ position: { x: 200, y: 2 } });
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".jv-focus")).toHaveAttribute("data-index", "1");
    const before = await page.locator(".jv-focus").getAttribute("data-index");

    // Focus the jq query input and press arrows — must not move .jv-focus.
    const jqInput = page.locator(".jv-query-input");
    await jqInput.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".jv-focus")).toHaveAttribute("data-index", before!);

    // Same for the find input.
    await page.keyboard.press("Control+f");
    const findInput = page.locator(".jv-find-input");
    await expect(findInput).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".jv-focus")).toHaveAttribute("data-index", before!);

    await ctx.close();
  });
});
