import { defineConfig } from "@playwright/test";
import { resolve } from "path";

// The extension must be built before running e2e tests.
// Run: cd extension && npm run build   then   npm run test:e2e

export default defineConfig({
  // All e2e tests live here, separate from Vitest unit tests in /tests/
  testDir: "./e2e",

  // Don't run tests in parallel — Chrome extension contexts share IndexedDB state
  workers: 1,
  fullyParallel: false,

  // Retry once on CI to reduce flakiness from slow startup
  retries: process.env.CI ? 1 : 0,

  // How long a single test can take (Groq API calls are intercepted, so should be fast)
  timeout: 20_000,

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    // The extension path — must be built first
    // Playwright will receive this via the fixture (see e2e/fixtures.js)
    extensionPath: resolve(import.meta.dirname, "."),

    // Screenshots on failure help diagnose UI bugs
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
