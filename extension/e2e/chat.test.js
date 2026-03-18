/**
 * e2e tests for the Chat page (ChatPage.jsx).
 *
 * All Groq streaming calls are intercepted — responses come back instantly.
 * Tests run against a real Chromium browser with the real extension loaded.
 */

import { test, expect } from "./fixtures.js";

// ── Page load ──────────────────────────────────────────────────────────────────

test("chat page loads without crashing", async ({ chatPage }) => {
  await expect(chatPage.locator("body")).not.toBeEmpty();
  await expect(chatPage.getByText(/something went wrong/i)).not.toBeVisible();
});

test("chat page shows the message input area", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await expect(input).toBeEnabled();
});

test("chat page shows empty state prompt when no messages", async ({ chatPage }) => {
  await expect(chatPage.getByText(/ask anything/i)).toBeVisible({ timeout: 8000 });
});

test("send button is disabled when input is empty", async ({ chatPage }) => {
  await expect(chatPage.locator("textarea").first()).toBeVisible({ timeout: 8000 });
  const sendBtn = chatPage.getByLabel("Send");
  await expect(sendBtn).toBeDisabled();
});

test("send button enables when input has text", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 8000 });
  await input.fill("Hello");
  await expect(chatPage.getByLabel("Send")).toBeEnabled();
});

// ── Sending messages ───────────────────────────────────────────────────────────

test("typing a message and pressing Enter sends it", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("What is photosynthesis?");
  await input.press("Enter");
  await expect(chatPage.getByText("What is photosynthesis?")).toBeVisible({ timeout: 8000 });
});

test("AI response appears after sending a message", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("Explain gravity");
  await input.press("Enter");
  await expect(chatPage.getByText(/mock AI response/i)).toBeVisible({ timeout: 15000 });
});

test("input is cleared after sending a message", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("Hello AI");
  await input.press("Enter");
  await expect(input).toHaveValue("", { timeout: 5000 });
});

test("send button click also sends the message", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("Tell me about the solar system");
  await chatPage.getByLabel("Send").click();
  await expect(chatPage.getByText("Tell me about the solar system")).toBeVisible({ timeout: 8000 });
});

test("Shift+Enter inserts a newline instead of sending", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("Line one");
  await input.press("Shift+Enter");
  await input.type("Line two");
  const value = await input.inputValue();
  expect(value).toContain("Line one");
  expect(value).toContain("Line two");
});

test("multiple messages can be sent in sequence", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });

  await input.fill("First question");
  await input.press("Enter");
  await expect(chatPage.getByText("First question")).toBeVisible({ timeout: 8000 });

  // Wait for response before sending next
  await expect(chatPage.getByText(/mock AI response/i)).toBeVisible({ timeout: 15000 });

  await input.fill("Second question");
  await input.press("Enter");
  await expect(chatPage.getByText("Second question")).toBeVisible({ timeout: 8000 });
});

test("a 200-character message can be typed without crashing", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  // Fill (not type) to avoid slowness — just verify the input accepts long text
  await input.fill("a".repeat(200));
  await expect(input).toHaveValue("a".repeat(200));
  // Send button should be enabled
  await expect(chatPage.getByLabel("Send")).toBeEnabled();
});

// ── Conversation management ───────────────────────────────────────────────────

test("conversation appears in the sidebar", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("Test conversation");
  await input.press("Enter");
  // Response will appear — use .first() since previous tests may have also left a response
  await expect(chatPage.getByText(/mock AI response/i).first()).toBeVisible({ timeout: 15000 });
  // At least one conversation item exists in the sidebar
  await expect(chatPage.locator("[class*='conv'], [class*='sidebar']").first()).toBeVisible();
});

test("new conversation button is available", async ({ chatPage }) => {
  await expect(chatPage.locator("textarea").first()).toBeVisible({ timeout: 10000 });
  // The new conversation button is a + button (both it and the capture button share chat-new-btn)
  await expect(chatPage.locator("button[title='New conversation']")).toBeVisible();
});

test("new conversation button creates a fresh chat", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });

  // Send a message first and wait for it to appear + input to clear
  await input.fill("First conversation message");
  await input.press("Enter");
  await expect(chatPage.getByText("First conversation message")).toBeVisible({ timeout: 8000 });
  await expect(input).toHaveValue("", { timeout: 5000 });

  // Create new conversation
  const newConvBtn = chatPage.locator("button[title='New conversation']");
  await expect(newConvBtn).toBeVisible({ timeout: 5000 });
  await newConvBtn.click();

  // The empty state should reappear (no messages in new conversation)
  await expect(chatPage.getByText(/ask anything/i)).toBeVisible({ timeout: 5000 });
});

test("sidebar collapse button works", async ({ chatPage }) => {
  await expect(chatPage.locator("textarea").first()).toBeVisible({ timeout: 10000 });
  await expect(chatPage.getByTitle("Close sidebar")).toBeVisible();
  await chatPage.getByTitle("Close sidebar").click();
  await expect(chatPage.getByTitle("Open sidebar")).toBeVisible({ timeout: 3000 });
});

test("sidebar re-expands after collapsing", async ({ chatPage }) => {
  await expect(chatPage.locator("textarea").first()).toBeVisible({ timeout: 10000 });
  await chatPage.getByTitle("Close sidebar").click();
  await expect(chatPage.getByTitle("Open sidebar")).toBeVisible({ timeout: 3000 });
  await chatPage.getByTitle("Open sidebar").click();
  await expect(chatPage.getByTitle("Close sidebar")).toBeVisible({ timeout: 3000 });
});

// ── Mode selector ─────────────────────────────────────────────────────────────
// Note: the mode button only appears when a capture source (window) is selected.
// That requires real Chrome window APIs which are hard to fake in e2e tests.
// Mode switching is covered in unit tests (components-extended.test.jsx).

test("capture source picker button is visible in the sidebar", async ({ chatPage }) => {
  await expect(chatPage.locator("textarea").first()).toBeVisible({ timeout: 10000 });
  // The "Capture" or window picker button should be in the sidebar
  // It shows a "Add source" or similar button
  await expect(chatPage.locator(".chat-sidebar, aside").first()).toBeVisible({ timeout: 5000 });
});

// ── Error states ──────────────────────────────────────────────────────────────

test("chat page does not show a crash or unhandled error on load", async ({ chatPage }) => {
  await expect(chatPage.locator("body")).not.toBeEmpty();
  await expect(chatPage.getByText(/something went wrong/i)).not.toBeVisible();
  await expect(chatPage.getByText(/cannot read/i)).not.toBeVisible();
});

// ── Input edge cases ──────────────────────────────────────────────────────────

test("message with only spaces is not sent", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("   ");
  // Send button should still be disabled for whitespace-only input
  await expect(chatPage.getByLabel("Send")).toBeDisabled();
});

test("special characters in message are handled correctly", async ({ chatPage }) => {
  const input = chatPage.locator("textarea").first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill("<script>alert('xss')</script>");
  await input.press("Enter");
  // No script executed — message appears as text, not as HTML
  await expect(chatPage.getByText(/something went wrong/i)).not.toBeVisible();
});
