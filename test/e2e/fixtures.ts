import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ext = fileURLToPath(new URL("../../result/extension", import.meta.url));

// Extensions require a persistent context. The full Chromium build
// (channel: "chromium") loads unpacked extensions in the new headless mode,
// so the suite runs windowless — no xvfb, no headed browser.
export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

export const expect = test.expect;
