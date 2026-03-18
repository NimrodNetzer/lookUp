/**
 * Playwright fixtures for LookUp Chrome extension e2e tests.
 *
 * Key constraints:
 *  - Chrome extensions require headless: false (they don't run in headless mode)
 *  - Cannot override built-in Playwright fixtures: context, page, browser, etc.
 *  - Worker-scoped fixtures can only depend on other worker-scoped fixtures
 *  - We use chromium.launchPersistentContext() to load unpacked extensions
 */

import { test as base, chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, ".."); // root of extension/

// Fake SSE stream that mimics Groq's chat completion response format.
// Each word is its own chunk — this tests that the UI handles streaming correctly.
function makeFakeStream(content = "This is a mock AI response for testing purposes.") {
  const words = content.split(" ");
  const chunks = words.map((word, i) =>
    JSON.stringify({
      choices: [{ delta: { content: (i === 0 ? "" : " ") + word }, finish_reason: null }],
    })
  );
  const done = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });
  return [...chunks, done].map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
}

// ── Worker-scoped fixtures: created once, shared by all tests in a file ───────

export const test = base.extend({

  // `extContext` — a real Chromium browser with the extension loaded.
  // Named `extContext` (not `context`) to avoid clashing with Playwright's built-in.
  // Worker scope = one Chrome instance per test file, not one per test.
  extContext: [async ({}, use) => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,   // Extensions require a real display
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    // Intercept all Groq API calls across every page in this browser.
    // Tests run instantly and use zero real API tokens.
    await ctx.route("https://api.groq.com/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/chat/completions")) {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          body: makeFakeStream(),
        });
      } else {
        // All other endpoints (verify key, transcription, etc.): generic 200
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: [], object: "list" }),
        });
      }
    });

    await use(ctx);
    await ctx.close();
  }, { scope: "worker" }],

  // `extId` — the extension's ID, extracted from the background service worker URL.
  // The service worker URL is: chrome-extension://<extId>/background.js
  // Worker scope = computed once and reused across tests.
  extId: [async ({ extContext }, use) => {
    // The extension's service worker may already be running — check first.
    // If not, wait for it to start (up to 10s).
    let sw = extContext.serviceWorkers()[0];
    if (!sw) {
      sw = await extContext.waitForEvent("serviceworker", { timeout: 10_000 });
    }

    // URL format: chrome-extension://abcdefghijklmnopqrstuvwxyz123456/background.js
    const extId = sw.url().split("/")[2];
    if (!extId) {
      throw new Error(
        `Could not extract extension ID from service worker: ${sw.url()}\n` +
        `Is the extension built? Run: cd extension && npm run build`
      );
    }

    await use(extId);
  }, { scope: "worker" }],

  // ── Test-scoped fixtures: a fresh page per test ────────────────────────────

  // `dashboardPage` — opens built/dashboard.html with a fake API key already set.
  // Without the key, App.jsx renders SetupScreen instead of HomePage.
  dashboardPage: async ({ extContext, extId }, use) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extId}/built/dashboard.html`);
    await page.waitForLoadState("domcontentloaded");

    // Seed a fake API key so Settings.isConfigured() returns true
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.storage.local.set({ groqApiKey: "gsk_fake_test_key_for_playwright" }, resolve);
      });
    });

    // Reload so App picks up the key and renders the real home page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close();
  },

  // `chatPage` — opens built/chat.html with a fake API key already set.
  chatPage: async ({ extContext, extId }, use) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extId}/built/chat.html`);
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(async () => {
      await new Promise((resolve) => {
        chrome.storage.local.set({ groqApiKey: "gsk_fake_test_key_for_playwright" }, resolve);
      });
    });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
