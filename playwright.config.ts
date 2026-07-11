import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const ext = fileURLToPath(new URL("./result/extension", import.meta.url));
export default defineConfig({
  testDir: "test/e2e",
  webServer: { command: "node test/serve.mjs", url: "http://localhost:8731/catalog.json", reuseExistingServer: true },
  use: {
    // Extensions require a persistent context with these args. Headless
    // Chromium (default and --headless=new) does not load unpacked
    // extensions reliably on this machine, so run headed; CI runs this
    // under xvfb-run (see .github/workflows/ci.yml).
    headless: false,
    launchOptions: { args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] },
  },
});
