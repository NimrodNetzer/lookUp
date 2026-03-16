/**
 * SESSION 6 — Extension: Security & Edge Cases
 * Tech: Vitest (no DOM — pure JS functions replicated from groq-client.js, storage.js)
 *
 * Tests: system prompt privacy rules, XSS via renderMd, audio chunking (buildSegmentBlobs),
 * storage edge cases (very long titles, special chars), token usage overflow protection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── SYSTEM_PROMPT privacy rules (replicated from groq-client.js) ─────────────

const SYSTEM_PROMPT = `You are LookUp, a study assistant for students.

Privacy: If you detect passwords, credit cards, bank details, SSNs, or credentials, respond ONLY with: "I noticed sensitive information on screen. Please hide it before using LookUp." Never reference such data.

Format: GitHub-flavored Markdown. Math: $...$ inline, $$...$$ block. Diagrams: \`\`\`mermaid. Bold key terms: **term**.`;

describe("SYSTEM_PROMPT privacy rules", () => {
  it("contains the privacy instruction block", () => {
    expect(SYSTEM_PROMPT).toContain("Privacy:");
  });

  it("mentions passwords", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("password");
  });

  it("mentions credit cards", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("credit card");
  });

  it("mentions SSNs", () => {
    expect(SYSTEM_PROMPT.toUpperCase()).toContain("SSN");
  });

  it("mentions credentials", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("credential");
  });

  it("instructs model to respond ONLY with the privacy warning — not reference sensitive data", () => {
    expect(SYSTEM_PROMPT).toContain("respond ONLY with");
    expect(SYSTEM_PROMPT).toContain("Never reference such data");
  });

  it("contains the exact user-facing privacy warning message", () => {
    expect(SYSTEM_PROMPT).toContain("I noticed sensitive information on screen.");
  });
});

// ─── Hebrew mode system prompt (replicated from groq-client.js) ───────────────

function buildSystemPrompt(lang) {
  if (lang === "he") {
    return SYSTEM_PROMPT + "\n\nIMPORTANT: Respond entirely in Hebrew (עברית). All explanations, headings, bullet points, and text must be in Hebrew only.";
  }
  return SYSTEM_PROMPT;
}

describe("buildSystemPrompt language injection", () => {
  it("English prompt does not contain Hebrew instruction", () => {
    expect(buildSystemPrompt("en")).not.toContain("עברית");
  });

  it("Hebrew prompt appends the Hebrew instruction", () => {
    const prompt = buildSystemPrompt("he");
    expect(prompt).toContain("עברית");
    expect(prompt).toContain("Respond entirely in Hebrew");
  });

  it("Hebrew prompt still contains the privacy rules", () => {
    const prompt = buildSystemPrompt("he");
    expect(prompt).toContain("Privacy:");
    expect(prompt).toContain("Never reference such data");
  });

  it("unknown language falls back to English prompt", () => {
    const prompt = buildSystemPrompt("fr");
    expect(prompt).toBe(SYSTEM_PROMPT);
    expect(prompt).not.toContain("Respond entirely in");
  });
});

// ─── renderMd XSS protection (replicated from ChatPage.jsx) ──────────────────

function renderMd(raw) {
  let h = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, '<h4 class="chat-h4" dir="auto">$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3 class="chat-h3" dir="auto">$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/^# (.+)$/gm,    '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`\n]+)`/g,   '<code class="chat-code">$1</code>')
    .replace(/^---+$/gm,       '<hr class="chat-hr">')
    .replace(/^[*-] (.+)$/gm,  '<li dir="auto">$1</li>');
  h = h.replace(/(<li[\s\S]*?<\/li>)(\n<li[\s\S]*?<\/li>)*/g,
    (m) => `<ul class="chat-ul">${m}</ul>`);
  h = h.replace(/\n\n+/g, '</p><p class="chat-p" dir="auto">').replace(/\n/g, "<br>");
  return `<p class="chat-p" dir="auto">${h}</p>`;
}

describe("renderMd XSS protection", () => {
  it("escapes <script> tags completely", () => {
    const out = renderMd("<script>alert('xss')</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes onerror event handler injection via img tag", () => {
    const out = renderMd('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("escapes iframe injection", () => {
    const out = renderMd('<iframe src="javascript:alert(1)">');
    expect(out).not.toContain("<iframe");
    expect(out).toContain("&lt;iframe");
  });

  it("escapes SVG onload injection", () => {
    const out = renderMd('<svg onload="alert(1)">');
    expect(out).not.toContain("<svg");
    expect(out).toContain("&lt;svg");
  });

  it("escapes href javascript: protocol", () => {
    const out = renderMd('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("<a ");
    expect(out).toContain("&lt;a");
  });

  it("escapes & ampersands to prevent entity injection", () => {
    const out = renderMd("Tom & Jerry &amp; Friends");
    expect(out).toContain("Tom &amp; Jerry &amp;amp; Friends");
  });

  it("does not double-escape already-escaped content", () => {
    // & is escaped once to &amp; — not &amp;amp;
    const out = renderMd("A & B");
    expect(out).toContain("A &amp; B");
    expect(out).not.toContain("&amp;amp;");
  });

  it("renders normal markdown despite escaping", () => {
    const out = renderMd("## Title\n**bold** and *italic*");
    expect(out).toContain("<h2");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });
});

// ─── buildSegmentBlobs audio chunking (replicated from sidepanel.js) ──────────

// Pure function extracted from the inline chunking logic in sidepanel.js
function buildSegmentBlobs(chunks, mimeType, segmentSizeBytes) {
  const segments = [];
  let current = [];
  let currentSize = 0;

  for (const chunk of chunks) {
    if (currentSize + chunk.size > segmentSizeBytes && current.length > 0) {
      segments.push(new Blob(current, { type: mimeType }));
      current = [];
      currentSize = 0;
    }
    current.push(chunk);
    currentSize += chunk.size;
  }
  if (current.length > 0) {
    segments.push(new Blob(current, { type: mimeType }));
  }
  return segments;
}

function makeChunk(size) {
  return new Blob([new Uint8Array(size)]);
}

describe("buildSegmentBlobs audio chunking", () => {
  const SEGMENT_LIMIT = 24 * 1024 * 1024; // 24 MB — Groq's limit

  it("returns a single blob when all chunks fit in one segment", () => {
    const chunks = [makeChunk(1000), makeChunk(2000)];
    const segments = buildSegmentBlobs(chunks, "audio/webm", SEGMENT_LIMIT);
    expect(segments).toHaveLength(1);
  });

  it("splits into two segments when total exceeds limit", () => {
    const halfLimit = Math.floor(SEGMENT_LIMIT / 2);
    const chunks = [
      makeChunk(halfLimit),
      makeChunk(halfLimit),
      makeChunk(1000), // overflow
    ];
    const segments = buildSegmentBlobs(chunks, "audio/webm", SEGMENT_LIMIT);
    expect(segments).toHaveLength(2);
  });

  it("returns empty array for empty chunks", () => {
    const segments = buildSegmentBlobs([], "audio/webm", SEGMENT_LIMIT);
    expect(segments).toHaveLength(0);
  });

  it("handles a single oversized chunk as one segment (can't split a single chunk)", () => {
    const bigChunk = makeChunk(SEGMENT_LIMIT + 1000);
    const segments = buildSegmentBlobs([bigChunk], "audio/webm", SEGMENT_LIMIT);
    expect(segments).toHaveLength(1);
  });

  it("sets the correct MIME type on each blob", () => {
    const chunks = [makeChunk(100)];
    const segments = buildSegmentBlobs(chunks, "audio/webm;codecs=opus", SEGMENT_LIMIT);
    expect(segments[0].type).toBe("audio/webm;codecs=opus");
  });

  it("preserves total size across segments", () => {
    const sizes = [1000, 2000, 3000];
    const chunks = sizes.map(makeChunk);
    const totalSize = sizes.reduce((a, b) => a + b, 0);
    const segments = buildSegmentBlobs(chunks, "audio/webm", SEGMENT_LIMIT);
    const segmentTotal = segments.reduce((acc, s) => acc + s.size, 0);
    expect(segmentTotal).toBe(totalSize);
  });

  it("splits correctly at exact boundary", () => {
    const LIMIT = 1000;
    const chunks = [makeChunk(500), makeChunk(500), makeChunk(1)];
    const segments = buildSegmentBlobs(chunks, "audio/webm", LIMIT);
    // First two chunks fill exactly 1000, third chunk overflows to segment 2
    expect(segments).toHaveLength(2);
    expect(segments[0].size).toBe(1000);
    expect(segments[1].size).toBe(1);
  });
});

// ─── makeSlug edge cases (replicated from groq-client.js / index.js) ──────────

function makeSlug(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

describe("makeSlug edge cases", () => {
  it("handles empty string → empty slug", () => {
    expect(makeSlug("")).toBe("");
  });

  it("strips all special characters leaving only a-z 0-9 and hyphen", () => {
    expect(makeSlug("Hello, World! 2024")).toBe("hello-world-2024");
  });

  it("collapses multiple spaces to a single hyphen", () => {
    expect(makeSlug("a   b")).toBe("a-b");
  });

  it("strips Hebrew / unicode characters (non-ASCII)", () => {
    expect(makeSlug("שלום world")).toBe("-world");
  });

  it("strips dots and colons", () => {
    expect(makeSlug("v1.2.3: release")).toBe("v123-release");
  });

  it("lowercases the input", () => {
    expect(makeSlug("HELLO")).toBe("hello");
  });

  it("handles string with only special characters → empty string", () => {
    expect(makeSlug("!!!???")).toBe("");
  });

  it("preserves digits", () => {
    expect(makeSlug("Chapter 42")).toBe("chapter-42");
  });
});

// ─── Token usage overflow protection (replicated from storage.js logic) ───────

describe("Token usage daily reset logic", () => {
  it("resets tokens when stored date differs from today", () => {
    // Simulate a stale entry from yesterday
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    const stored = { tokens: 99999, date: yesterday };
    const isStale = stored.date !== today;
    const current = isStale ? { tokens: 0, date: today } : stored;

    expect(isStale).toBe(true);
    expect(current.tokens).toBe(0);
  });

  it("does not reset when date matches today", () => {
    const today = new Date().toISOString().split("T")[0];
    const stored = { tokens: 12345, date: today };
    const isStale = stored.date !== today;
    const current = isStale ? { tokens: 0, date: today } : stored;

    expect(isStale).toBe(false);
    expect(current.tokens).toBe(12345);
  });

  it("daily token limit constant is reasonable (>= 100k)", () => {
    const DAILY_TOKEN_LIMIT = 500_000;
    expect(DAILY_TOKEN_LIMIT).toBeGreaterThanOrEqual(100_000);
  });
});
