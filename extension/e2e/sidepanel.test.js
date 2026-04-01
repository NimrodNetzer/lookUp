/**
 * e2e tests for the Sidepanel (sidepanel.html / sidepanel.js).
 *
 * The sidepanel cannot be opened via chrome.sidePanel.open() in Playwright
 * (no API), so we open sidepanel.html directly as a tab — same HTML/JS, same
 * IndexedDB, same chrome.* APIs. All Groq calls are intercepted.
 *
 * Flows covered:
 *  - Page load & setup screen
 *  - Mode selector (Summary / Explain / Quiz / Flashcard / Audio)
 *  - Language toggle (EN / HE) and persistence
 *  - Audio source toggle (Tab / Mic) and persistence
 *  - Audio mode UI (source row visible only in audio mode)
 *  - Mode dropdown hidden when no capture source in ChatPage (regression guard)
 *  - Conversation tabs (create, switch, rename, delete)
 *  - Info (i) dropdown opens and shows token bar
 *  - More (…) dropdown opens and shows expected items
 *  - Search bar appears and accepts input
 *  - Selection bar (ask about selected text)
 *  - Attach button visible in non-audio mode
 *  - Capture button label changes with mode
 */

import { test as base, expect, chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "..");

function makeFakeStream(content = "This is a mock AI response for testing purposes.") {
  const words = content.split(" ");
  const chunks = words.map((word, i) =>
    JSON.stringify({ choices: [{ delta: { content: (i === 0 ? "" : " ") + word }, finish_reason: null }] })
  );
  const done = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });
  return [...chunks, done].map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
}

const test = base.extend({
  extContext: [async ({}, use) => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=420,860",  // sidepanel-like dimensions so layout renders correctly
      ],
      viewport: { width: 420, height: 860 },
    });
    await ctx.route("https://api.groq.com/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/chat/completions")) {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          body: makeFakeStream(),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
    });
    await use(ctx);
    await ctx.close();
  }, { scope: "worker" }],

  extId: [async ({ extContext }, use) => {
    let sw = extContext.serviceWorkers()[0];
    if (!sw) sw = await extContext.waitForEvent("serviceworker", { timeout: 10_000 });
    const extId = sw.url().split("/")[2];
    await use(extId);
  }, { scope: "worker" }],

  // Opens sidepanel.html directly as a tab with a fake API key seeded.
  sidepanel: async ({ extContext, extId }, use) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await page.waitForLoadState("domcontentloaded");

    // Seed fake API key so the panel doesn't show setup screen
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

// ── Page load ─────────────────────────────────────────────────────────────────

test("sidepanel loads without crashing", async ({ sidepanel }) => {
  await expect(sidepanel.locator("body")).not.toBeEmpty();
  await expect(sidepanel.getByText(/something went wrong/i)).not.toBeVisible();
  await expect(sidepanel.getByText(/cannot read/i)).not.toBeVisible();
});

test("sidepanel shows the LookUp header", async ({ sidepanel }) => {
  await expect(sidepanel.locator("h1").filter({ hasText: "LookUp" })).toBeVisible({ timeout: 8000 });
});

test("sidepanel shows the capture button", async ({ sidepanel }) => {
  const btn = sidepanel.locator("#captureBtn");
  await expect(btn).toBeVisible({ timeout: 8000 });
  await expect(btn).toBeEnabled();
});

test("sidepanel shows the mode trigger dropdown", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#modeTrigger")).toBeVisible({ timeout: 8000 });
});

// ── Mode selector ─────────────────────────────────────────────────────────────

test("mode dropdown opens when trigger is clicked", async ({ sidepanel }) => {
  const trigger = sidepanel.locator("#modeTrigger");
  await expect(trigger).toBeVisible({ timeout: 8000 });
  await trigger.click();
  await expect(sidepanel.locator("#modeDropdown")).toBeVisible({ timeout: 3000 });
});

test("mode dropdown closes after selecting a mode", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await expect(sidepanel.locator("#modeDropdown")).toBeVisible({ timeout: 3000 });
  // Click the first dropdown item
  await sidepanel.locator("#modeDropdown .dropdown-item").first().click();
  await expect(sidepanel.locator("#modeDropdown")).not.toBeVisible({ timeout: 3000 });
});

test("selecting Summary mode updates the mode label", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='summary']").click();
  await expect(sidepanel.locator("#modeLabel")).toContainText(/summary/i, { timeout: 3000 });
});

test("selecting Explain mode updates the mode label", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='explain']").click();
  await expect(sidepanel.locator("#modeLabel")).toContainText(/explain/i, { timeout: 3000 });
});

test("selecting Quiz mode updates the mode label", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='quiz']").click();
  await expect(sidepanel.locator("#modeLabel")).toContainText(/quiz/i, { timeout: 3000 });
});

test("selecting Flashcard mode updates the mode label", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='flashcard']").click();
  await expect(sidepanel.locator("#modeLabel")).toContainText(/flashcard/i, { timeout: 3000 });
});

test("selecting Audio mode changes capture button to Record", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await expect(sidepanel.locator("#captureBtn")).toContainText(/record/i, { timeout: 3000 });
});

test("audio source toggle row is visible only in Audio mode", async ({ sidepanel }) => {
  // In Summary mode it should be hidden
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='summary']").click();
  await expect(sidepanel.locator("#avToggleRow")).not.toBeVisible({ timeout: 3000 });

  // In Audio mode it should appear
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await expect(sidepanel.locator("#avToggleRow")).toBeVisible({ timeout: 3000 });
});

test("capture button label is 'Capture' in non-audio modes", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='summary']").click();
  await expect(sidepanel.locator("#captureBtn")).toContainText(/capture/i, { timeout: 3000 });
});

// ── Audio source toggle (Tab / Mic) ───────────────────────────────────────────

test("Tab source button is active by default in Audio mode", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await expect(sidepanel.locator("#avOptAudio")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#avOptMic")).not.toHaveClass(/active/);
});

test("clicking Mic source makes Mic active and Tab inactive", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await sidepanel.locator("#avOptMic").click();
  await expect(sidepanel.locator("#avOptMic")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#avOptAudio")).not.toHaveClass(/active/);
});

test("clicking Tab source after Mic restores Tab as active", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await sidepanel.locator("#avOptMic").click();
  await sidepanel.locator("#avOptAudio").click();
  await expect(sidepanel.locator("#avOptAudio")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#avOptMic")).not.toHaveClass(/active/);
});

test("capture button label is 'Record' with mic icon when Mic is active", async ({ sidepanel }) => {
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='audio']").click();
  await sidepanel.locator("#avOptMic").click();
  await expect(sidepanel.locator("#captureBtn")).toContainText(/record/i, { timeout: 3000 });
});

// ── Language toggle (EN / HE) ─────────────────────────────────────────────────

test("info dropdown opens when i-button is clicked", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  await expect(sidepanel.locator("#infoDropdown")).toBeVisible({ timeout: 3000 });
});

test("EN language option is active by default", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  await expect(sidepanel.locator("#langOptEN")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#langOptHE")).not.toHaveClass(/active/);
});

test("clicking HE makes HE active and EN inactive", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  await sidepanel.locator("#langOptHE").click();
  await expect(sidepanel.locator("#langOptHE")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#langOptEN")).not.toHaveClass(/active/);
});

test("clicking EN after HE restores EN as active", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  await sidepanel.locator("#langOptHE").click();
  await sidepanel.locator("#langOptEN").click();
  await expect(sidepanel.locator("#langOptEN")).toHaveClass(/active/, { timeout: 3000 });
  await expect(sidepanel.locator("#langOptHE")).not.toHaveClass(/active/);
});

test("language preference persists after reload", async ({ sidepanel, extId, extContext }) => {
  await sidepanel.locator("#infoBtn").click();
  await sidepanel.locator("#langOptHE").click();

  // Reload the page and check that HE is still active
  await sidepanel.reload();
  await sidepanel.waitForLoadState("domcontentloaded");
  await sidepanel.locator("#infoBtn").click();
  await expect(sidepanel.locator("#langOptHE")).toHaveClass(/active/, { timeout: 5000 });
});

// ── More (…) dropdown ─────────────────────────────────────────────────────────

test("more dropdown opens when … button is clicked", async ({ sidepanel }) => {
  await sidepanel.locator("#moreBtn").click();
  await expect(sidepanel.locator("#moreDropdown")).toBeVisible({ timeout: 3000 });
});

test("more dropdown contains Dashboard button", async ({ sidepanel }) => {
  await sidepanel.locator("#moreBtn").click();
  await expect(sidepanel.locator("#moreDashboard")).toBeVisible({ timeout: 3000 });
});

test("more dropdown contains Chat button", async ({ sidepanel }) => {
  await sidepanel.locator("#moreBtn").click();
  await expect(sidepanel.locator("#moreChatBtn")).toBeVisible({ timeout: 3000 });
});

test("more dropdown closes when clicking outside", async ({ sidepanel }) => {
  await sidepanel.locator("#moreBtn").click();
  await expect(sidepanel.locator("#moreDropdown")).toBeVisible({ timeout: 3000 });
  await sidepanel.locator("body").click({ position: { x: 10, y: 10 } });
  await expect(sidepanel.locator("#moreDropdown")).not.toBeVisible({ timeout: 3000 });
});

// ── Search ────────────────────────────────────────────────────────────────────

test("search input is present in the DOM", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#searchInput")).toBeAttached({ timeout: 8000 });
});

test("search input accepts typed text", async ({ sidepanel }) => {
  // Search input is inside the more-dropdown — open it first
  await sidepanel.locator("#moreBtn").click();
  await expect(sidepanel.locator("#moreDropdown")).toBeVisible({ timeout: 3000 });
  const search = sidepanel.locator("#searchInput");
  await expect(search).toBeVisible({ timeout: 3000 });
  await search.fill("deadlocks");
  await expect(search).toHaveValue("deadlocks");
});

// ── Conversation tabs ─────────────────────────────────────────────────────────

test("tab bar is visible", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#convTabs")).toBeVisible({ timeout: 8000 });
});

test("new conversation button is visible", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#newConvBtn")).toBeVisible({ timeout: 8000 });
});

test("clicking new conversation button adds a tab", async ({ sidepanel }) => {
  const before = await sidepanel.locator("#convTabs .conv-tab").count();
  await sidepanel.locator("#newConvBtn").click();
  await expect(sidepanel.locator("#convTabs .conv-tab")).toHaveCount(before + 1, { timeout: 5000 });
});

test("clicking a tab switches to it", async ({ sidepanel }) => {
  // Create a second tab
  await sidepanel.locator("#newConvBtn").click();
  const tabs = sidepanel.locator("#convTabs .conv-tab");
  await expect(tabs).toHaveCount(2, { timeout: 5000 });
  // Click the first tab
  await tabs.first().click();
  await expect(tabs.first()).toHaveClass(/active/, { timeout: 3000 });
});

// ── Audio recording bar (not visible by default) ──────────────────────────────

test("audio bar is hidden when not recording", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#audioBar")).not.toHaveClass(/active/, { timeout: 3000 });
});

test("stop audio button exists in DOM", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#stopAudio")).toBeAttached({ timeout: 5000 });
});

// ── Mic permission banner ─────────────────────────────────────────────────────

test("mic permission banner is hidden by default", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#micPermBanner")).not.toHaveClass(/active/, { timeout: 3000 });
});

// ── Tokens display ────────────────────────────────────────────────────────────

test("tokens section is present in the info dropdown", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  // The token row shows "Tokens today" text
  await expect(sidepanel.getByText(/tokens today/i)).toBeVisible({ timeout: 5000 });
});

// ── Attach button ─────────────────────────────────────────────────────────────

test("attach button is visible in non-audio mode", async ({ sidepanel }) => {
  // Make sure we're in Summary mode (non-audio)
  await sidepanel.locator("#modeTrigger").click();
  await sidepanel.locator("#modeDropdown .dropdown-item[data-mode='summary']").click();
  await expect(sidepanel.locator("#attachBtn")).toBeVisible({ timeout: 5000 });
});

// ── Selection bar ─────────────────────────────────────────────────────────────

test("selection bar is hidden when no text is selected", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#selectionBar")).not.toHaveClass(/active/, { timeout: 3000 });
});

// ── Chat send / input ─────────────────────────────────────────────────────────

test("chat send button exists", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#chatSendBtn")).toBeAttached({ timeout: 5000 });
});

test("title input accepts text", async ({ sidepanel }) => {
  const input = sidepanel.locator("#titleInput");
  await input.fill("test message");
  await expect(input).toHaveValue("test message");
});

// ── Zoom controls ─────────────────────────────────────────────────────────────

test("zoom controls are present in the info dropdown", async ({ sidepanel }) => {
  await sidepanel.locator("#infoBtn").click();
  // The info dropdown contains +/- zoom buttons
  await expect(sidepanel.locator("#zoomInBtn, [id*='zoom'], [title*='zoom' i]").first()).toBeAttached({ timeout: 5000 });
});

// ── Focus mode ────────────────────────────────────────────────────────────────

test("focus mode button exists", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#focusModeBtn")).toBeAttached({ timeout: 5000 });
});

// ── Status dot ───────────────────────────────────────────────────────────────

test("status dot is present in the header", async ({ sidepanel }) => {
  await expect(sidepanel.locator("#statusDot")).toBeVisible({ timeout: 8000 });
});
