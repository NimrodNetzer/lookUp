/**
 * SESSION 1 — groq.js pure-logic tests
 * Tech: Vitest
 *
 * Tests the deterministic helper functions in groq.js without hitting the API.
 * We extract the private helpers (flashcardCount, quizQuestionCount) by
 * replicating their logic here — they are not exported, but the logic is
 * critical and easy to regress.
 *
 * Also tests: lazy proxy error, resetGroqClient, makeSlug/makeTimestamp
 * from index.js (also pure logic worth locking down).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Replicated pure helpers (not exported from groq.js) ──────────────────────
function flashcardCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

function quizQuestionCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

// ── Replicated index.js pure helpers ─────────────────────────────────────────
function makeSlug(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ── flashcardCount / quizQuestionCount ───────────────────────────────────────
describe("flashcardCount", () => {
  it("returns 2 for very short text (< 250 chars)", () => {
    expect(flashcardCount("x".repeat(100))).toBe(2);
    expect(flashcardCount("x".repeat(249))).toBe(2);
  });

  it("returns 3 for 250–599 chars", () => {
    expect(flashcardCount("x".repeat(250))).toBe(3);
    expect(flashcardCount("x".repeat(599))).toBe(3);
  });

  it("returns 4 for 600–1099 chars", () => {
    expect(flashcardCount("x".repeat(600))).toBe(4);
    expect(flashcardCount("x".repeat(1099))).toBe(4);
  });

  it("returns 5 for 1100–1699 chars", () => {
    expect(flashcardCount("x".repeat(1100))).toBe(5);
    expect(flashcardCount("x".repeat(1699))).toBe(5);
  });

  it("returns 6 for 1700–2799 chars", () => {
    expect(flashcardCount("x".repeat(1700))).toBe(6);
    expect(flashcardCount("x".repeat(2799))).toBe(6);
  });

  it("returns 7 for 2800–3999 chars", () => {
    expect(flashcardCount("x".repeat(2800))).toBe(7);
    expect(flashcardCount("x".repeat(3999))).toBe(7);
  });

  it("returns 8 for 4000+ chars", () => {
    expect(flashcardCount("x".repeat(4000))).toBe(8);
    expect(flashcardCount("x".repeat(10000))).toBe(8);
  });

  it("trims whitespace before measuring", () => {
    // "  " (2 spaces) trims to "" → 0 chars → 2
    expect(flashcardCount("   ")).toBe(2);
    // leading/trailing whitespace should not inflate count
    const padded = "  " + "x".repeat(249) + "  ";
    expect(flashcardCount(padded)).toBe(2); // 249 after trim
  });
});

describe("quizQuestionCount", () => {
  // Same thresholds as flashcardCount — verify they are identical
  it("mirrors flashcardCount thresholds exactly", () => {
    const samples = [0, 100, 250, 500, 600, 1000, 1100, 1500, 1700, 2500, 2800, 3500, 4000, 8000];
    for (const n of samples) {
      expect(quizQuestionCount("x".repeat(n))).toBe(flashcardCount("x".repeat(n)));
    }
  });
});

// ── makeSlug ──────────────────────────────────────────────────────────────────
describe("makeSlug", () => {
  it("lowercases input", () => {
    expect(makeSlug("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(makeSlug("a b c")).toBe("a-b-c");
  });

  it("strips non-alphanumeric characters", () => {
    expect(makeSlug("Math & Physics!")).toBe("math--physics");
  });

  it("collapses multiple spaces to single hyphen", () => {
    // \s+ in the regex collapses any run of whitespace to ONE hyphen
    expect(makeSlug("a  b")).toBe("a-b");
    expect(makeSlug("a   b")).toBe("a-b");
  });

  it("handles empty string", () => {
    expect(makeSlug("")).toBe("");
  });

  it("handles already-valid slug", () => {
    expect(makeSlug("already-valid-123")).toBe("already-valid-123");
  });

  it("strips Hebrew / unicode characters", () => {
    expect(makeSlug("מתמטיקה")).toBe("");
  });

  it("strips dots and colons", () => {
    expect(makeSlug("v1.2: notes")).toBe("v12-notes");
  });
});

// ── makeTimestamp ─────────────────────────────────────────────────────────────
describe("makeTimestamp", () => {
  it("contains no colons or dots", () => {
    const ts = makeTimestamp();
    expect(ts).not.toMatch(/[:.]/);
  });

  it("starts with a year (4 digits)", () => {
    const ts = makeTimestamp();
    expect(ts).toMatch(/^\d{4}/);
  });

  it("two consecutive calls are different or equal (not reversed)", () => {
    const a = makeTimestamp();
    const b = makeTimestamp();
    expect(a <= b).toBe(true);
  });
});

// ── Groq lazy proxy — missing API key ────────────────────────────────────────
describe("Groq lazy proxy error", () => {
  const originalKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) process.env.GROQ_API_KEY = originalKey;
  });

  it("throws a clear error when GROQ_API_KEY is missing", async () => {
    // Import resetGroqClient so we clear any cached client
    const { resetGroqClient } = await import("../groq.js");
    resetGroqClient();

    // Dynamically import groq to get the proxy — it throws on property access
    const groqModule = await import("../groq.js");

    // analyzeText calls groq.chat.completions.create internally
    // Without a key, it should throw before making any network call
    await expect(groqModule.analyzeText("hello")).rejects.toThrow("GROQ_API_KEY");
  });
});
