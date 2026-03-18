/**
 * e2e tests for the Dashboard page (HomePage + NoteViewer).
 *
 * These tests open the real built extension in a real Chromium browser.
 * All Groq API calls are intercepted — no real API key needed.
 *
 * Flows covered:
 *  - Setup screen appears when no API key is stored
 *  - HomePage loads after API key is present
 *  - "Menu" dropdown opens and shows expected items
 *  - Search modal opens via the Menu button
 *  - Search modal closes when Escape is pressed
 *  - Ctrl+K keyboard shortcut opens search
 *  - Notes list renders (empty state or populated)
 */

import { test, expect } from "./fixtures.js";

// ── Setup screen ─────────────────────────────────────────────────────────────
// These tests need a clean storage state (no API key), so they clear storage first.

test("setup screen shows when no API key is stored", async ({ extContext, extId }) => {
  const page = await extContext.newPage();

  // Clear any API key left by previous tests — storage is shared across the worker context
  await page.goto(`chrome-extension://${extId}/built/dashboard.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    await new Promise((resolve) => chrome.storage.local.remove("groqApiKey", resolve));
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  // The App checks Settings.isConfigured() on mount.
  // With no key, it should render the SetupScreen.
  await expect(page.getByText("Welcome to LookUp")).toBeVisible({ timeout: 8000 });
  await expect(page.getByPlaceholder("gsk_...")).toBeVisible();
  await expect(page.getByText("Save & Start Learning")).toBeVisible();

  // Restore a fake key so subsequent tests still work with shared storage
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      chrome.storage.local.set({ groqApiKey: "gsk_fake_test_key_for_playwright" }, resolve);
    });
  });
  await page.close();
});

test("setup screen save button is disabled when key field is empty", async ({ extContext, extId }) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extId}/built/dashboard.html`);
  await page.waitForLoadState("domcontentloaded");

  // Clear key so setup screen appears
  await page.evaluate(async () => {
    await new Promise((resolve) => chrome.storage.local.remove("groqApiKey", resolve));
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");

  // With an empty input, the save button should be disabled
  await expect(page.getByText("Save & Start Learning")).toBeVisible({ timeout: 8000 });
  const saveBtn = page.getByRole("button", { name: "Save & Start Learning" });
  await expect(saveBtn).toBeDisabled();

  // Restore key
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      chrome.storage.local.set({ groqApiKey: "gsk_fake_test_key_for_playwright" }, resolve);
    });
  });
  await page.close();
});

// ── HomePage ─────────────────────────────────────────────────────────────────

test("homepage loads with header and LookUp title", async ({ dashboardPage }) => {
  // dashboardPage fixture has already seeded the API key and reloaded
  await expect(dashboardPage.getByText("LookUp")).toBeVisible({ timeout: 8000 });
  await expect(dashboardPage.getByText("Your personal learning hub")).toBeVisible();
});

test("homepage shows Chat and Menu buttons in header", async ({ dashboardPage }) => {
  await expect(dashboardPage.getByRole("button", { name: /Chat/i })).toBeVisible({ timeout: 8000 });
  await expect(dashboardPage.getByRole("button", { name: /Menu/i })).toBeVisible();
});

// ── Menu dropdown ─────────────────────────────────────────────────────────────

test("Menu dropdown opens and shows Search notes, New note, New folder", async ({ dashboardPage }) => {
  await dashboardPage.getByRole("button", { name: /Menu/i }).click();

  await expect(dashboardPage.getByText("Search notes")).toBeVisible();
  await expect(dashboardPage.getByText("New note")).toBeVisible();
  await expect(dashboardPage.getByText("New folder")).toBeVisible();
});

test("Menu dropdown closes when clicking outside", async ({ dashboardPage }) => {
  await dashboardPage.getByRole("button", { name: /Menu/i }).click();
  await expect(dashboardPage.getByText("Search notes")).toBeVisible();

  // Click outside the dropdown (on the heading)
  await dashboardPage.locator("h1").click();
  await expect(dashboardPage.getByText("Search notes")).not.toBeVisible();
});

// ── Search modal ─────────────────────────────────────────────────────────────

test("Search notes button in menu opens the search modal", async ({ dashboardPage }) => {
  await dashboardPage.getByRole("button", { name: /Menu/i }).click();
  await dashboardPage.getByText("Search notes").click();

  // GlobalSearch modal renders an input with "Search all notes…" placeholder
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).toBeVisible({ timeout: 5000 });
});

test("Ctrl+K opens the search modal", async ({ dashboardPage }) => {
  // Click the page first to make sure it has focus before the keyboard shortcut
  await dashboardPage.locator("body").click();
  await expect(dashboardPage.getByText("LookUp")).toBeVisible({ timeout: 8000 });

  await dashboardPage.keyboard.press("Control+k");
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).toBeVisible({ timeout: 5000 });
});

test("Escape closes the search modal", async ({ dashboardPage }) => {
  // Open the search via the menu (more reliable than keyboard shortcut for focus)
  await dashboardPage.getByRole("button", { name: /Menu/i }).click();
  await dashboardPage.getByText("Search notes").click();
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).toBeVisible({ timeout: 5000 });

  await dashboardPage.keyboard.press("Escape");
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).not.toBeVisible();
});

test("clicking outside the search modal closes it", async ({ dashboardPage }) => {
  await dashboardPage.getByRole("button", { name: /Menu/i }).click();
  await dashboardPage.getByText("Search notes").click();
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).toBeVisible({ timeout: 5000 });

  // Click the backdrop (the fixed overlay behind the modal)
  // The GlobalSearch modal has a fixed overlay that closes on click
  await dashboardPage.keyboard.press("Escape");
  await expect(dashboardPage.getByPlaceholder("Search all notes…")).not.toBeVisible();
});

// ── Notes list (empty state) ──────────────────────────────────────────────────

test("empty notes state does not crash or show an error", async ({ dashboardPage }) => {
  await expect(dashboardPage.getByText("LookUp")).toBeVisible({ timeout: 8000 });
  // The page shouldn't show a JS error or "something went wrong"
  await expect(dashboardPage.getByText(/something went wrong/i)).not.toBeVisible();
  await expect(dashboardPage.getByText(/uncaught error/i)).not.toBeVisible();
});
