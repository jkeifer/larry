import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  webServer: { command: "node test/serve.mjs", url: "http://localhost:8731/catalog.json", reuseExistingServer: true },
  // Extension launch (persistent context + headless Chromium) lives in
  // test/e2e/fixtures.ts, since it requires per-test context creation.
});
